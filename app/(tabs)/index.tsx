import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, Pressable, FlatList, ScrollView, ActivityIndicator,
  Alert, Platform, KeyboardAvoidingView, useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Marker, Polyline, mapProvider } from '../../lib/Map';
import * as Location from 'expo-location';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import {
  searchPlaces, resolvePlace, routeBetween, newSessionToken, looksOutstation,
  CITY_CENTRE, type PlaceSuggestion, type RouteResult,
} from '../../lib/maps';
import {
  estimateFare, formatINR, availableVehicles, isOutstation, isRoundTrip,
  TRIP_LABELS, type TripKind,
} from '../../lib/fare';
import type { RiderTier, VehicleClass } from '../../lib/rates';
import { useRates } from '../../lib/useRates';
import { api, BILLING_URL } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { colors, spacing, radius } from '../../lib/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
type Picked = { name: string; lat: number; lng: number } | null;

const TRIP_ORDER: TripKind[] = [
  'city_one_way',
  'city_round_trip',
  'outstation_one_way',
  'outstation_round_trip',
  'hourly',
];

const TIERS: RiderTier[] = ['public', 'member', 'official'];

export default function Home() {
  const { user } = useAuth();
  const { rates, source: rateSource, refresh: refreshRates } = useRates();
  const { height: screenH } = useWindowDimensions();
  const mapRef = useRef<MapView>(null);

  const [region] = useState({
    latitude: CITY_CENTRE.lat, longitude: CITY_CENTRE.lng,
    latitudeDelta: 0.08, longitudeDelta: 0.08,
  });
  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [hasLocPerm, setHasLocPerm] = useState(false);

  const [activeField, setActiveField] = useState<'pickup' | 'drop'>('pickup');
  const [pickupText, setPickupText] = useState('');
  const [dropText, setDropText] = useState('');
  const [pickup, setPickup] = useState<Picked>(null);
  const [drop, setDrop] = useState<Picked>(null);
  const [searchOpen, setSearchOpen] = useState(false);

  const [results, setResults] = useState<PlaceSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  // One Places session per search overlay visit — keeps autocomplete billing sane.
  const sessionToken = useRef(newSessionToken());

  const [tripKind, setTripKind] = useState<TripKind>('city_one_way');
  // Cleared once the rider picks a trip type themselves.
  const autoTrip = useRef(true);
  const [vehicle, setVehicle] = useState<VehicleClass>('hatchback');
  const [tier, setTier] = useState<RiderTier>('public');

  const [nightStays, setNightStays] = useState(0);
  const [showBreakdown, setShowBreakdown] = useState(false);

  const [route, setRoute] = useState<RouteResult | null>(null);
  const [routing, setRouting] = useState(false);
  const [booking, setBooking] = useState(false);

  const [scheduled, setScheduled] = useState(false);
  const [scheduledAt, setScheduledAt] = useState<Date>(() => {
    const d = new Date(); d.setHours(d.getHours() + 2, 0, 0, 0); return d;
  });
  const [iosPicker, setIosPicker] = useState<null | 'date' | 'time'>(null);

  const vehicleOptions = useMemo(() => {
    const ids = availableVehicles(rates, tripKind);
    return rates.vehicles.filter((v) => ids.includes(v.id));
  }, [rates, tripKind]);

  // Keep the selected vehicle valid when the trip type narrows the fleet.
  useEffect(() => {
    if (vehicleOptions.length && !vehicleOptions.some((v) => v.id === vehicle)) {
      setVehicle(vehicleOptions[0].id);
    }
  }, [vehicleOptions, vehicle]);

  function openAndroidPicker(mode: 'date' | 'time') {
    DateTimePickerAndroid.open({
      value: scheduledAt, mode, minimumDate: new Date(), is24Hour: false,
      onChange: (_, selected) => {
        if (!selected) return;
        const next = new Date(scheduledAt);
        if (mode === 'date') next.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
        else next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
        setScheduledAt(next);
      },
    });
  }

  async function fetchCurrentLocation(setAsPickup = true) {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Location permission needed', 'Enable location in Settings to use your current location as pickup.');
      return;
    }
    setHasLocPerm(true);
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const here = { lat: loc.coords.latitude, lng: loc.coords.longitude };
    setUserLoc(here);
    const next = { latitude: here.lat, longitude: here.lng, latitudeDelta: 0.02, longitudeDelta: 0.02 };
    mapRef.current?.animateToRegion(next, 600);

    if (setAsPickup) {
      try {
        const r = await Location.reverseGeocodeAsync({ latitude: here.lat, longitude: here.lng });
        const name = r[0] ? [r[0].name, r[0].street, r[0].city].filter(Boolean).join(', ') : 'Current location';
        setPickupText(name);
        setPickup({ name, lat: here.lat, lng: here.lng });
      } catch {
        setPickupText('Current location');
        setPickup({ name: 'Current location', lat: here.lat, lng: here.lng });
      }
    }
  }

  useEffect(() => { fetchCurrentLocation(true); }, []);

  // Debounced place search.
  useEffect(() => {
    const q = activeField === 'pickup' ? pickupText : dropText;
    if (!q || q.length < 3) { setResults([]); setSearching(false); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      const r = await searchPlaces(q, { sessionToken: sessionToken.current, near: userLoc });
      setResults(r);
      setSearching(false);
    }, 350);
    return () => clearTimeout(t);
  }, [pickupText, dropText, activeField, userLoc]);

  // Route whenever both ends are set.
  useEffect(() => {
    if (!pickup || !drop) { setRoute(null); return; }
    setRouting(true);
    routeBetween({ lat: pickup.lat, lng: pickup.lng }, { lat: drop.lat, lng: drop.lng })
      .then((r) => {
        setRoute(r);
        if (r?.geometry.length && mapRef.current) {
          mapRef.current.fitToCoordinates(r.geometry, {
            edgePadding: { top: 120, right: 60, bottom: screenH * 0.55, left: 60 },
            animated: true,
          });
        }
      })
      .finally(() => setRouting(false));
  }, [pickup, drop, screenH]);

  // Suggest the right category — the rider shouldn't have to know the city limit.
  useEffect(() => {
    if (!drop || !autoTrip.current) return;
    const out = looksOutstation({ lat: drop.lat, lng: drop.lng });
    setTripKind((prev) => {
      if (out === isOutstation(prev)) return prev;
      const round = isRoundTrip(prev);
      return out
        ? (round ? 'outstation_round_trip' : 'outstation_one_way')
        : (round ? 'city_round_trip' : 'city_one_way');
    });
  }, [drop]);

  async function pickResult(s: PlaceSuggestion) {
    const resolved = await resolvePlace(s, sessionToken.current);
    if (!resolved) { Alert.alert('Could not load that place', 'Please pick another result.'); return; }
    // Session is consumed by the details call — start a fresh one.
    sessionToken.current = newSessionToken();

    const picked = { name: resolved.name, lat: resolved.lat, lng: resolved.lng };
    if (activeField === 'pickup') { setPickup(picked); setPickupText(picked.name); setActiveField('drop'); }
    else { setDrop(picked); setDropText(picked.name); setSearchOpen(false); }
    setResults([]);
  }

  function clearField(which: 'pickup' | 'drop') {
    if (which === 'pickup') { setPickupText(''); setPickup(null); }
    else { setDropText(''); setDrop(null); }
    setResults([]);
  }

  const distanceKm = route?.distanceKm ?? 0;
  const quotable = tripKind === 'hourly' ? !!pickup : !!route;

  const fare = useMemo(() => {
    if (!quotable) return null;
    return estimateFare({
      rates, distanceKm, tripKind, vehicle, tier,
      nightStays: isOutstation(tripKind) ? nightStays : 0,
    });
  }, [quotable, rates, distanceKm, tripKind, vehicle, tier, nightStays]);

  async function onConfirmBooking() {
    if (!fare || !pickup || !user) return;
    if (tripKind !== 'hourly' && !drop) return;
    if (scheduled && scheduledAt.getTime() < Date.now() + 15 * 60 * 1000) {
      Alert.alert('Pick a time at least 15 minutes from now.');
      return;
    }

    setBooking(true);
    const pickupAt = scheduled
      ? new Date(scheduledAt)
      : (() => { const d = new Date(); d.setMinutes(d.getMinutes() + 15); return d; })();

    try {
      // CSCBilling: creates the Trip and runs the first dispatch wave, so the
      // nearest on-duty drivers see it immediately.
      await api('/api/customer/rides', {
        baseUrl: BILLING_URL,
        method: 'POST',
        body: {
          pickup: { address: pickup.name, lat: pickup.lat, lng: pickup.lng },
          dropoff: drop
            ? { address: drop.name, lat: drop.lat, lng: drop.lng }
            : { address: 'Package — vehicle at disposal', lat: pickup.lat, lng: pickup.lng },
          // Kept as-is for the existing CSCBilling enum; the precise CSC
          // category travels in tripKind below.
          tripType: 'one_way',
          scheduledAt: pickupAt.toISOString(),
          paymentMode: 'cash',
          vehicleType: vehicle,
          distance: Number(distanceKm.toFixed(1)),
          // Client estimate — CSCBilling remains authoritative on the final bill.
          fareEstimate: fare.total,
          tripKind,
          riderTier: tier,
          nightStays: isOutstation(tripKind) ? nightStays : 0,
          rateVersion: rates.version,
          notes: [
            TRIP_LABELS[tripKind],
            vehicle,
            fare.discountPct > 0 ? `${fare.discountLabel} ${fare.discountPct}%` : null,
            scheduled ? 'scheduled' : null,
          ].filter(Boolean).join(' · '),
        },
      });
    } catch (e: any) {
      setBooking(false);
      Alert.alert('Booking failed', e.message ?? 'Try again');
      return;
    }

    setBooking(false);
    Alert.alert(
      scheduled ? 'Scheduled!' : 'Booked!',
      scheduled
        ? `Your ${vehicle} is scheduled for ${pickupAt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}.`
        : `Your ${vehicle} is booked. Our team will call you shortly.`,
      [{ text: 'OK' }],
    );
    setDrop(null); setDropText(''); setRoute(null); setNightStays(0);
  }

  const sheetMaxH = screenH * 0.62;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={{ flex: 1 }}>
          <MapView
            ref={mapRef}
            style={{ flex: 1 }}
            provider={mapProvider}
            initialRegion={region}
            showsUserLocation={hasLocPerm}
            showsMyLocationButton={false}
            showsCompass
            showsTraffic
            loadingEnabled
            loadingIndicatorColor={colors.primary}
            mapPadding={{ top: 120, right: 0, bottom: Math.round(sheetMaxH * 0.6), left: 0 }}
          >
            {pickup && (
              <Marker coordinate={{ latitude: pickup.lat, longitude: pickup.lng }} title="Pickup" anchor={{ x: 0.5, y: 1 }}>
                <PinLabel text="Pickup" color={colors.success} icon="location" />
              </Marker>
            )}
            {drop && (
              <Marker coordinate={{ latitude: drop.lat, longitude: drop.lng }} title="Drop" anchor={{ x: 0.5, y: 1 }}>
                <PinLabel text="Drop" color={colors.accent} icon="flag" />
              </Marker>
            )}
            {route && <Polyline coordinates={route.geometry} strokeColor={colors.primary} strokeWidth={5} />}
          </MapView>

          {/* Search bar — top */}
          <View style={{ position: 'absolute', top: spacing.md, left: spacing.md, right: spacing.md }}>
            <Pressable
              onPress={() => { setSearchOpen(true); setActiveField(pickup ? 'drop' : 'pickup'); }}
              style={{
                backgroundColor: 'white', borderRadius: radius.lg, padding: spacing.md,
                shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6,
              }}>
              <FieldRow icon="radio-button-on" iconColor={colors.success} label="From" value={pickupText || 'Pickup location'} muted={!pickupText} />
              <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 8 }} />
              <FieldRow icon="flag" iconColor={colors.accent} label="To" value={dropText || 'Where to?'} muted={!dropText} />
            </Pressable>
          </View>

          <Pressable
            onPress={() => fetchCurrentLocation(false)}
            style={({ pressed }) => ({
              position: 'absolute', right: spacing.md, bottom: sheetMaxH + 12,
              width: 48, height: 48, borderRadius: 24, backgroundColor: 'white',
              alignItems: 'center', justifyContent: 'center',
              shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 6,
              opacity: pressed ? 0.7 : 1,
            })}>
            <Ionicons name="locate" size={22} color={colors.primary} />
          </Pressable>

          {/* Bottom sheet */}
          <View style={{
            position: 'absolute', bottom: 0, left: 0, right: 0, maxHeight: sheetMaxH,
            backgroundColor: 'white', borderTopLeftRadius: 24, borderTopRightRadius: 24,
            shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 16, elevation: 10,
          }}>
            <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#d1d5db', marginTop: 8 }} />

            <ScrollView
              contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.lg, gap: spacing.sm }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}>

              {/* Trip type */}
              <SectionLabel>Trip type</SectionLabel>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.xs, paddingRight: spacing.lg }}>
                {TRIP_ORDER.map((t) => (
                  <Chip
                    key={t}
                    label={TRIP_LABELS[t]}
                    selected={tripKind === t}
                    onPress={() => { autoTrip.current = false; setTripKind(t); }}
                  />
                ))}
              </ScrollView>

              {/* Vehicle */}
              <SectionLabel>Vehicle</SectionLabel>
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                {vehicleOptions.map((v) => {
                  const on = vehicle === v.id;
                  const price = tripKind === 'hourly'
                    ? rates.hourly[0]?.price[v.id]
                    : isOutstation(tripKind) ? rates.outstation.perKm[v.id] : rates.city.perKm;
                  return (
                    <Pressable
                      key={v.id}
                      onPress={() => setVehicle(v.id)}
                      style={({ pressed }) => ({
                        flex: 1, paddingVertical: spacing.sm, paddingHorizontal: 4, borderRadius: radius.md,
                        borderWidth: 2, borderColor: on ? colors.primary : colors.border,
                        backgroundColor: on ? colors.primaryLight : 'white',
                        alignItems: 'center', opacity: pressed ? 0.7 : 1,
                      })}>
                      <Ionicons name={v.icon as IconName} size={20} color={on ? colors.primaryDark : colors.text} />
                      <Text numberOfLines={1} style={{ marginTop: 2, fontWeight: '700', fontSize: 11, color: on ? colors.primaryDark : colors.text }}>
                        {v.label}
                      </Text>
                      {typeof price === 'number' && (
                        <Text style={{ fontSize: 9, color: colors.textMuted }}>
                          {tripKind === 'hourly' ? formatINR(price) : `₹${price}/km`}
                        </Text>
                      )}
                    </Pressable>
                  );
                })}
              </View>

              {/* Rider tier — the benefit-discount circular */}
              <SectionLabel>Fare category</SectionLabel>
              <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                {TIERS.map((t) => {
                  const cfg = rates.discounts[t];
                  const on = tier === t;
                  return (
                    <Pressable
                      key={t}
                      onPress={() => setTier(t)}
                      style={({ pressed }) => ({
                        flex: 1, paddingVertical: 8, borderRadius: radius.md,
                        borderWidth: 2, borderColor: on ? colors.primary : colors.border,
                        backgroundColor: on ? colors.primaryLight : 'white',
                        alignItems: 'center', opacity: pressed ? 0.7 : 1,
                      })}>
                      <Text numberOfLines={1} style={{ fontWeight: '700', fontSize: 11, color: on ? colors.primaryDark : colors.text }}>
                        {cfg.label}
                      </Text>
                      <Text style={{ fontSize: 10, color: cfg.pct > 0 ? colors.success : colors.textMuted, fontWeight: '700' }}>
                        {cfg.pct > 0 ? `${cfg.pct}% off` : 'No discount'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Night stay — outstation only */}
              {isOutstation(tripKind) && (
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 4 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '700', color: colors.text, fontSize: 13 }}>Driver night stay</Text>
                    <Text style={{ color: colors.textMuted, fontSize: 11 }}>₹{rates.outstation.nightStayCharge} per night · as per approval</Text>
                  </View>
                  <Stepper value={nightStays} onChange={setNightStays} />
                </View>
              )}

              {/* Now / Schedule */}
              <View style={{ flexDirection: 'row', gap: spacing.xs }}>
                <Pressable onPress={() => setScheduled(false)}
                  style={{ flex: 1, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: !scheduled ? colors.primary : '#f3f4f6', alignItems: 'center' }}>
                  <Text style={{ color: !scheduled ? 'white' : colors.text, fontWeight: '700', fontSize: 12 }}>Ride now</Text>
                </Pressable>
                <Pressable onPress={() => setScheduled(true)}
                  style={{ flex: 1, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: scheduled ? colors.primary : '#f3f4f6', alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 4 }}>
                  <Ionicons name="calendar" size={14} color={scheduled ? 'white' : colors.text} />
                  <Text style={{ color: scheduled ? 'white' : colors.text, fontWeight: '700', fontSize: 12 }}>Schedule</Text>
                </Pressable>
              </View>

              {scheduled && (
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                  <PickerButton
                    label="Date"
                    value={scheduledAt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                    onPress={() => Platform.OS === 'android' ? openAndroidPicker('date') : setIosPicker('date')}
                  />
                  <PickerButton
                    label="Time"
                    value={scheduledAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                    onPress={() => Platform.OS === 'android' ? openAndroidPicker('time') : setIosPicker('time')}
                  />
                </View>
              )}

              {Platform.OS === 'ios' && iosPicker && (
                <DateTimePicker
                  value={scheduledAt}
                  mode={iosPicker}
                  display="spinner"
                  minimumDate={new Date()}
                  onChange={(_, selected) => { setIosPicker(null); if (selected) setScheduledAt(selected); }}
                />
              )}

              {/* Fare */}
              {routing ? (
                <View style={{ padding: spacing.sm, alignItems: 'center' }}><ActivityIndicator color={colors.primary} /></View>
              ) : fare ? (
                <View style={{ backgroundColor: colors.primaryLight, padding: spacing.sm, borderRadius: radius.md, gap: 6 }}>
                  <Pressable onPress={() => setShowBreakdown((s) => !s)} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.textMuted, fontSize: 11 }}>
                        {tripKind === 'hourly'
                          ? `${rates.hourly[0]?.hours ?? 8} hours · vehicle only`
                          : `${distanceKm.toFixed(1)} km${isRoundTrip(tripKind) ? ' each way' : ''} · ~${Math.round(route?.durationMin ?? 0)} min`}
                      </Text>
                      <Text style={{ fontSize: 22, fontWeight: '800', color: colors.text }}>{formatINR(fare.total)}</Text>
                      {fare.discountAmount > 0 && (
                        <Text style={{ fontSize: 11, color: colors.success, fontWeight: '700' }}>
                          {fare.discountLabel} · {fare.discountPct}% off saves {formatINR(fare.discountAmount)}
                        </Text>
                      )}
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ color: colors.textMuted, fontSize: 11 }}>Estimated</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                        <Text style={{ color: colors.primaryDark, fontSize: 11, fontWeight: '700' }}>Details</Text>
                        <Ionicons name={showBreakdown ? 'chevron-up' : 'chevron-down'} size={14} color={colors.primaryDark} />
                      </View>
                    </View>
                  </Pressable>

                  {showBreakdown && (
                    <View style={{ borderTopWidth: 1, borderTopColor: '#fed7aa', paddingTop: 6, gap: 3 }}>
                      {fare.baseLines.map((l, i) => (
                        <BreakdownRow key={i} label={l.label} detail={l.detail} amount={formatINR(l.amount)} />
                      ))}
                      {fare.minimumApplied && (
                        <BreakdownRow label="Minimum fare applied" amount={formatINR(fare.baseFare)} />
                      )}
                      {fare.discountAmount > 0 && (
                        <BreakdownRow label={`${fare.discountLabel} discount`} detail={`${fare.discountPct}% on base fare`} amount={`− ${formatINR(fare.discountAmount)}`} good />
                      )}
                      {fare.extraLines.map((l, i) => (
                        <BreakdownRow key={`x${i}`} label={l.label} detail={l.detail} amount={formatINR(l.amount)} />
                      ))}
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, paddingTop: 4, borderTopWidth: 1, borderTopColor: '#fed7aa' }}>
                        <Text style={{ fontWeight: '800', color: colors.text, fontSize: 13 }}>Total</Text>
                        <Text style={{ fontWeight: '800', color: colors.text, fontSize: 13 }}>{formatINR(fare.total)}</Text>
                      </View>
                      {fare.notes.map((n, i) => (
                        <Text key={`n${i}`} style={{ fontSize: 10, color: colors.textMuted, marginTop: 2 }}>• {n}</Text>
                      ))}
                    </View>
                  )}
                </View>
              ) : (
                <Text style={{ color: colors.textMuted, textAlign: 'center', paddingVertical: 6, fontSize: 12 }}>
                  {pickup ? 'Pick a drop location to see fare' : 'Set pickup to start'}
                </Text>
              )}

              <Pressable
                onPress={onConfirmBooking}
                disabled={!fare || booking}
                style={({ pressed }) => ({
                  backgroundColor: !fare || booking ? '#fed7aa' : colors.primary,
                  padding: spacing.md, borderRadius: radius.lg, alignItems: 'center', opacity: pressed ? 0.85 : 1,
                })}>
                {booking ? <ActivityIndicator color="white" /> : (
                  <Text style={{ color: 'white', fontWeight: '800', fontSize: 15 }}>
                    {fare ? `${scheduled ? 'Schedule' : 'Book'} · ${formatINR(fare.total)}` : 'Book Ride'}
                  </Text>
                )}
              </Pressable>

              <Pressable onPress={refreshRates} style={{ alignItems: 'center', paddingTop: 2 }}>
                <Text style={{ fontSize: 9, color: colors.textMuted }}>
                  Rate card {rates.version}
                  {rateSource === 'live' ? ' · live' : rateSource === 'cached' ? ' · saved' : ' · offline'}
                  {' · tap to refresh'}
                </Text>
              </Pressable>
            </ScrollView>
          </View>

          {/* Search overlay */}
          {searchOpen && (
            <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.bg }}>
              <SafeAreaView style={{ flex: 1 }} edges={['top']}>
                <View style={{ flexDirection: 'row', alignItems: 'center', padding: spacing.md, gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                  <Pressable onPress={() => setSearchOpen(false)} hitSlop={12}>
                    <Ionicons name="arrow-back" size={26} color={colors.text} />
                  </Pressable>
                  <Text style={{ fontSize: 18, fontWeight: '800', color: colors.text }}>Where to?</Text>
                </View>

                <View style={{ padding: spacing.md, gap: spacing.sm }}>
                  <InputRow
                    icon="radio-button-on" iconColor={colors.success} placeholder="Pickup location"
                    value={pickupText} onChange={setPickupText}
                    onFocus={() => setActiveField('pickup')} onClear={() => clearField('pickup')}
                    active={activeField === 'pickup'}
                  />
                  <InputRow
                    icon="flag" iconColor={colors.accent} placeholder="Drop location"
                    value={dropText} onChange={setDropText}
                    onFocus={() => setActiveField('drop')} onClear={() => clearField('drop')}
                    active={activeField === 'drop'} autoFocus
                  />

                  <Pressable
                    onPress={async () => { await fetchCurrentLocation(true); setActiveField('drop'); }}
                    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, opacity: pressed ? 0.6 : 1 })}>
                    <Ionicons name="locate" size={20} color={colors.primary} />
                    <Text style={{ color: colors.primary, fontWeight: '700' }}>Use current location</Text>
                  </Pressable>
                </View>

                {searching && <ActivityIndicator color={colors.primary} style={{ marginTop: 12 }} />}

                <FlatList
                  data={results}
                  keyExtractor={(r, i) => r.id + i}
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={{ padding: spacing.md }}
                  renderItem={({ item }) => (
                    <Pressable onPress={() => pickResult(item)} style={({ pressed }) => ({ paddingVertical: spacing.sm, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, opacity: pressed ? 0.6 : 1 })}>
                      <Ionicons name="location-outline" size={20} color={colors.textMuted} style={{ marginTop: 2 }} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.text, fontWeight: '600' }} numberOfLines={1}>{item.primary}</Text>
                        {!!item.secondary && <Text style={{ color: colors.textMuted, fontSize: 12 }} numberOfLines={1}>{item.secondary}</Text>}
                      </View>
                    </Pressable>
                  )}
                  ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: colors.border }} />}
                  ListEmptyComponent={!searching ? (
                    <Text style={{ color: colors.textMuted, textAlign: 'center', marginTop: 32, fontSize: 13 }}>
                      Start typing a destination
                    </Text>
                  ) : null}
                />

                {pickup && drop && (
                  <View style={{ padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border }}>
                    <Pressable onPress={() => setSearchOpen(false)}
                      style={{ backgroundColor: colors.primary, padding: spacing.md, borderRadius: radius.lg, alignItems: 'center' }}>
                      <Text style={{ color: 'white', fontWeight: '800', fontSize: 15 }}>Done</Text>
                    </Pressable>
                  </View>
                )}
              </SafeAreaView>
            </View>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text style={{ fontSize: 10, fontWeight: '800', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 2 }}>
      {children}
    </Text>
  );
}

function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({
      paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.pill,
      borderWidth: 2, borderColor: selected ? colors.primary : colors.border,
      backgroundColor: selected ? colors.primaryLight : 'white', opacity: pressed ? 0.7 : 1,
    })}>
      <Text style={{ fontSize: 12, fontWeight: '700', color: selected ? colors.primaryDark : colors.text }}>{label}</Text>
    </Pressable>
  );
}

function Stepper({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
      <Pressable onPress={() => onChange(Math.max(0, value - 1))} hitSlop={8}>
        <Ionicons name="remove-circle-outline" size={26} color={value === 0 ? colors.border : colors.primary} />
      </Pressable>
      <Text style={{ fontWeight: '800', fontSize: 15, color: colors.text, minWidth: 16, textAlign: 'center' }}>{value}</Text>
      <Pressable onPress={() => onChange(value + 1)} hitSlop={8}>
        <Ionicons name="add-circle-outline" size={26} color={colors.primary} />
      </Pressable>
    </View>
  );
}

function BreakdownRow({ label, detail, amount, good }: { label: string; detail?: string; amount: string; good?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 12, color: colors.text }}>{label}</Text>
        {!!detail && <Text style={{ fontSize: 10, color: colors.textMuted }}>{detail}</Text>}
      </View>
      <Text style={{ fontSize: 12, fontWeight: '700', color: good ? colors.success : colors.text }}>{amount}</Text>
    </View>
  );
}

function PickerButton({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ flex: 1, padding: 10, borderRadius: radius.md, borderWidth: 2, borderColor: colors.border, backgroundColor: 'white' }}>
      <Text style={{ fontSize: 10, color: colors.textMuted, fontWeight: '700', textTransform: 'uppercase' }}>{label}</Text>
      <Text style={{ fontSize: 14, color: colors.text, fontWeight: '700' }}>{value}</Text>
    </Pressable>
  );
}

function PinLabel({ text, color, icon }: { text: string; color: string; icon: IconName }) {
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ backgroundColor: color, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, marginBottom: 4 }}>
        <Text style={{ color: 'white', fontWeight: '700', fontSize: 11 }}>{text}</Text>
      </View>
      <Ionicons name={icon} size={36} color={color} />
    </View>
  );
}

function FieldRow({ icon, iconColor, label, value, muted }: { icon: IconName; iconColor: string; label: string; value: string; muted?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <View style={{ width: 28, alignItems: 'center' }}><Ionicons name={icon} size={18} color={iconColor} /></View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 10, color: colors.textMuted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</Text>
        <Text numberOfLines={1} style={{ fontSize: 14, color: muted ? colors.textMuted : colors.text, fontWeight: '600' }}>{value}</Text>
      </View>
    </View>
  );
}

function InputRow({ icon, iconColor, placeholder, value, onChange, onFocus, onClear, active, autoFocus }: {
  icon: IconName; iconColor: string; placeholder: string; value: string;
  onChange: (s: string) => void; onFocus: () => void; onClear: () => void;
  active: boolean; autoFocus?: boolean;
}) {
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      borderWidth: 2, borderColor: active ? colors.primary : colors.border,
      borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 4, backgroundColor: 'white',
    }}>
      <Ionicons name={icon} size={20} color={iconColor} />
      <TextInput
        value={value} onChangeText={onChange} onFocus={onFocus}
        placeholder={placeholder} placeholderTextColor={colors.textMuted} autoFocus={autoFocus}
        style={{ flex: 1, fontSize: 15, color: colors.text, paddingVertical: 10 }}
      />
      {value.length > 0 && (
        <Pressable onPress={onClear} hitSlop={10}>
          <Ionicons name="close-circle" size={20} color={colors.textMuted} />
        </Pressable>
      )}
    </View>
  );
}
