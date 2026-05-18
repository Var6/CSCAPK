import { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, FlatList, ActivityIndicator, Alert, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Marker, Polyline, PROVIDER_DEFAULT, UrlTile } from 'react-native-maps';
import * as Location from 'expo-location';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { searchPlaces, routeBetween, type GeocodeResult, type Route } from '../../lib/maps';
import { estimateFare, formatINR, type TripKind, type VehicleKind } from '../../lib/fare';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { colors, spacing, radius } from '../../lib/theme';

const PATNA = { latitude: 25.5941, longitude: 85.1376 };

type Picked = { name: string; lat: number; lng: number } | null;

export default function Home() {
  const { user, profile } = useAuth();
  const mapRef = useRef<MapView>(null);

  const [region, setRegion] = useState({ ...PATNA, latitudeDelta: 0.08, longitudeDelta: 0.08 });
  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null);

  const [activeField, setActiveField] = useState<'pickup' | 'drop'>('pickup');
  const [pickupText, setPickupText] = useState('');
  const [dropText, setDropText] = useState('');
  const [pickup, setPickup] = useState<Picked>(null);
  const [drop, setDrop] = useState<Picked>(null);

  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);

  const [vehicle, setVehicle] = useState<VehicleKind>('car');
  const [tripKind, setTripKind] = useState<TripKind>('city');
  const [passengers, setPassengers] = useState(2);

  const [route, setRoute] = useState<Route | null>(null);
  const [routing, setRouting] = useState(false);
  const [booking, setBooking] = useState(false);

  // Scheduling
  const [scheduled, setScheduled] = useState(false);
  const [scheduledAt, setScheduledAt] = useState<Date>(() => {
    const d = new Date(); d.setHours(d.getHours() + 2, 0, 0, 0); return d;
  });
  const [iosPicker, setIosPicker] = useState<null | 'date' | 'time'>(null);

  function openAndroidPicker(mode: 'date' | 'time') {
    DateTimePickerAndroid.open({
      value: scheduledAt,
      mode,
      minimumDate: new Date(),
      is24Hour: false,
      onChange: (_, selected) => {
        if (!selected) return;
        const next = new Date(scheduledAt);
        if (mode === 'date') {
          next.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
        } else {
          next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
        }
        setScheduledAt(next);
      },
    });
  }

  // Ask for location once.
  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const loc = await Location.getCurrentPositionAsync({});
      const here = { lat: loc.coords.latitude, lng: loc.coords.longitude };
      setUserLoc(here);
      setRegion({ latitude: here.lat, longitude: here.lng, latitudeDelta: 0.05, longitudeDelta: 0.05 });
      // Auto-fill pickup with current location coords (reverse geocode best-effort).
      try {
        const r = await Location.reverseGeocodeAsync({ latitude: here.lat, longitude: here.lng });
        const name = r[0] ? [r[0].name, r[0].street, r[0].city].filter(Boolean).join(', ') : 'Current location';
        setPickupText(name);
        setPickup({ name, lat: here.lat, lng: here.lng });
      } catch {
        setPickupText('Current location');
        setPickup({ name: 'Current location', lat: here.lat, lng: here.lng });
      }
    })();
  }, []);

  // Debounced search.
  useEffect(() => {
    const q = activeField === 'pickup' ? pickupText : dropText;
    if (!q || q.length < 3) { setResults([]); return; }
    setSearching(true);
    const t = setTimeout(async () => {
      const r = await searchPlaces(q, userLoc ?? undefined);
      setResults(r);
      setSearching(false);
    }, 400);
    return () => clearTimeout(t);
  }, [pickupText, dropText, activeField, userLoc]);

  // Route when both points set.
  useEffect(() => {
    if (!pickup || !drop) { setRoute(null); return; }
    setRouting(true);
    routeBetween({ lat: pickup.lat, lng: pickup.lng }, { lat: drop.lat, lng: drop.lng })
      .then((r) => {
        setRoute(r);
        if (r && mapRef.current) {
          mapRef.current.fitToCoordinates(r.geometry, {
            edgePadding: { top: 80, right: 60, bottom: 360, left: 60 },
            animated: true,
          });
        }
      })
      .finally(() => setRouting(false));
  }, [pickup, drop]);

  function pickResult(r: GeocodeResult) {
    const picked = { name: r.display_name.split(',').slice(0, 3).join(', '), lat: r.lat, lng: r.lng };
    if (activeField === 'pickup') { setPickup(picked); setPickupText(picked.name); }
    else { setDrop(picked); setDropText(picked.name); }
    setResults([]);
  }

  const fare = route
    ? estimateFare({ distanceKm: route.distanceKm, tripKind, vehicle, discountPct: profile?.discount_pct ?? 0 })
    : null;

  async function onConfirmBooking() {
    if (!pickup || !drop || !route || !fare || !user) return;
    if (scheduled && scheduledAt.getTime() < Date.now() + 15 * 60 * 1000) {
      Alert.alert('Pick a time at least 15 minutes from now.');
      return;
    }
    setBooking(true);
    const pickupAt = scheduled
      ? new Date(scheduledAt)
      : (() => { const d = new Date(); d.setMinutes(d.getMinutes() + 15); return d; })();

    const { error } = await supabase.from('bookings').insert({
      user_id: user.id,
      customer_name: profile?.full_name ?? user.email ?? 'App user',
      phone: profile?.phone ?? '',
      email: user.email,
      pickup: pickup.name,
      drop_location: drop.name,
      pickup_at: pickupAt.toISOString(),
      vehicle_type: vehicle,
      trip_type: tripKind === 'city' || tripKind === 'one_way' ? 'one_way' : tripKind === 'outstation' ? 'outstation' : 'hourly',
      passengers,
      pickup_lat: pickup.lat,
      pickup_lng: pickup.lng,
      drop_lat: drop.lat,
      drop_lng: drop.lng,
      distance_km: route.distanceKm.toFixed(2),
      estimated_fare: fare.preDiscount,
      discount_pct: fare.discountPct,
      final_fare: fare.total,
      is_scheduled: scheduled,
    });

    setBooking(false);
    if (error) {
      Alert.alert('Booking failed', error.message);
      return;
    }
    Alert.alert(
      scheduled ? 'Scheduled!' : 'Booked!',
      scheduled
        ? `Your ${vehicle} is scheduled for ${pickupAt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}. A driver will be assigned shortly.`
        : `Your ${vehicle} is booked. Our team will call you shortly.`,
      [{ text: 'OK' }]
    );
    setDrop(null); setDropText(''); setRoute(null);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <View style={{ flex: 1 }}>
        <MapView
          ref={mapRef}
          style={{ flex: 1 }}
          provider={PROVIDER_DEFAULT}
          region={region}
          onRegionChangeComplete={setRegion}
          showsUserLocation
          showsMyLocationButton={Platform.OS === 'android'}
          mapType={Platform.OS === 'android' ? 'none' : 'standard'}
        >
          {Platform.OS === 'android' && (
            <UrlTile
              urlTemplate="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
              maximumZ={19}
              flipY={false}
            />
          )}
          {pickup && <Marker coordinate={{ latitude: pickup.lat, longitude: pickup.lng }} title="Pickup" pinColor={colors.primary} />}
          {drop && <Marker coordinate={{ latitude: drop.lat, longitude: drop.lng }} title="Drop" pinColor={colors.accent} />}
          {route && <Polyline coordinates={route.geometry} strokeColor={colors.primary} strokeWidth={5} />}
        </MapView>

        {/* Search panel */}
        <View style={{ position: 'absolute', top: spacing.md, left: spacing.md, right: spacing.md, backgroundColor: 'white', borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6 }}>
          <FieldRow
            label="From"
            value={pickupText}
            onFocus={() => setActiveField('pickup')}
            onChange={setPickupText}
            placeholder="Pickup location"
            active={activeField === 'pickup'}
          />
          <View style={{ height: 1, backgroundColor: colors.border }} />
          <FieldRow
            label="To"
            value={dropText}
            onFocus={() => setActiveField('drop')}
            onChange={setDropText}
            placeholder="Where to?"
            active={activeField === 'drop'}
          />
          {searching && <ActivityIndicator color={colors.primary} />}
          {results.length > 0 && (
            <View style={{ maxHeight: 220, marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
              <FlatList
                data={results}
                keyExtractor={(r, i) => r.display_name + i}
                renderItem={({ item }) => (
                  <Pressable onPress={() => pickResult(item)} style={({ pressed }) => ({ paddingVertical: spacing.sm, opacity: pressed ? 0.6 : 1 })}>
                    <Text numberOfLines={2} style={{ color: colors.text }}>{item.display_name}</Text>
                  </Pressable>
                )}
              />
            </View>
          )}
        </View>

        {/* Bottom sheet */}
        <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'white', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: spacing.lg, gap: spacing.md, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 16, elevation: 10 }}>

          {/* Vehicle pills */}
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {(['car', 'traveler', 'bus'] as VehicleKind[]).map((v) => (
              <Pressable
                key={v}
                onPress={() => setVehicle(v)}
                style={({ pressed }) => ({
                  flex: 1, padding: spacing.md, borderRadius: radius.md,
                  borderWidth: 2,
                  borderColor: vehicle === v ? colors.primary : colors.border,
                  backgroundColor: vehicle === v ? colors.primaryLight : 'white',
                  alignItems: 'center', opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text style={{ fontSize: 20 }}>{v === 'car' ? '🚗' : v === 'bus' ? '🚌' : '🚐'}</Text>
                <Text style={{ marginTop: 2, fontWeight: '700', color: vehicle === v ? colors.primaryDark : colors.text, fontSize: 12 }}>
                  {v === 'car' ? 'Car' : v === 'bus' ? 'Bus' : 'Traveler'}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Trip kind */}
          <View style={{ flexDirection: 'row', gap: spacing.xs }}>
            {(['city', 'one_way', 'outstation', 'hourly'] as TripKind[]).map((t) => (
              <Pressable
                key={t}
                onPress={() => setTripKind(t)}
                style={({ pressed }) => ({
                  flex: 1, paddingVertical: spacing.sm, borderRadius: radius.pill,
                  backgroundColor: tripKind === t ? colors.primary : '#f3f4f6',
                  alignItems: 'center', opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text style={{ color: tripKind === t ? 'white' : colors.text, fontWeight: '600', fontSize: 11 }}>
                  {t === 'one_way' ? 'One-way' : t.charAt(0).toUpperCase() + t.slice(1)}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Schedule toggle */}
          <View style={{ flexDirection: 'row', gap: spacing.xs }}>
            <Pressable
              onPress={() => setScheduled(false)}
              style={({ pressed }) => ({
                flex: 1, paddingVertical: spacing.sm, borderRadius: radius.pill,
                backgroundColor: !scheduled ? colors.primary : '#f3f4f6',
                alignItems: 'center', opacity: pressed ? 0.7 : 1,
              })}>
              <Text style={{ color: !scheduled ? 'white' : colors.text, fontWeight: '700', fontSize: 12 }}>Ride now</Text>
            </Pressable>
            <Pressable
              onPress={() => setScheduled(true)}
              style={({ pressed }) => ({
                flex: 1, paddingVertical: spacing.sm, borderRadius: radius.pill,
                backgroundColor: scheduled ? colors.primary : '#f3f4f6',
                alignItems: 'center', opacity: pressed ? 0.7 : 1,
              })}>
              <Text style={{ color: scheduled ? 'white' : colors.text, fontWeight: '700', fontSize: 12 }}>📅 Schedule</Text>
            </Pressable>
          </View>

          {scheduled && (
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              <Pressable
                onPress={() => Platform.OS === 'android' ? openAndroidPicker('date') : setIosPicker('date')}
                style={({ pressed }) => ({ flex: 1, padding: spacing.md, borderRadius: radius.md, borderWidth: 2, borderColor: colors.border, backgroundColor: 'white', opacity: pressed ? 0.7 : 1 })}>
                <Text style={{ fontSize: 10, color: colors.textMuted, fontWeight: '700', textTransform: 'uppercase' }}>Date</Text>
                <Text style={{ fontSize: 15, color: colors.text, fontWeight: '700', marginTop: 2 }}>
                  {scheduledAt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => Platform.OS === 'android' ? openAndroidPicker('time') : setIosPicker('time')}
                style={({ pressed }) => ({ flex: 1, padding: spacing.md, borderRadius: radius.md, borderWidth: 2, borderColor: colors.border, backgroundColor: 'white', opacity: pressed ? 0.7 : 1 })}>
                <Text style={{ fontSize: 10, color: colors.textMuted, fontWeight: '700', textTransform: 'uppercase' }}>Time</Text>
                <Text style={{ fontSize: 15, color: colors.text, fontWeight: '700', marginTop: 2 }}>
                  {scheduledAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </Pressable>
            </View>
          )}

          {Platform.OS === 'ios' && iosPicker && (
            <DateTimePicker
              value={scheduledAt}
              mode={iosPicker}
              display="spinner"
              minimumDate={new Date()}
              onChange={(_, selected) => {
                setIosPicker(null);
                if (selected) setScheduledAt(selected);
              }}
            />
          )}

          {/* Fare card */}
          {routing ? (
            <View style={{ padding: spacing.md, alignItems: 'center' }}>
              <ActivityIndicator color={colors.primary} />
              <Text style={{ color: colors.textMuted, marginTop: 6 }}>Calculating route…</Text>
            </View>
          ) : fare && route ? (
            <View style={{ backgroundColor: colors.primaryLight, padding: spacing.md, borderRadius: radius.md }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.xs }}>
                <Text style={{ color: colors.textMuted }}>{route.distanceKm.toFixed(1)} km · ~{Math.round(route.durationMin)} min</Text>
                {fare.discountPct > 0 && (
                  <Text style={{ color: colors.success, fontWeight: '700' }}>{fare.discountPct}% OFF</Text>
                )}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 28, fontWeight: '800', color: colors.text }}>{formatINR(fare.total)}</Text>
                {fare.discountAmount > 0 && (
                  <Text style={{ textDecorationLine: 'line-through', color: colors.textMuted }}>{formatINR(fare.preDiscount)}</Text>
                )}
              </View>
              <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>Estimated fare · toll & parking extra</Text>
            </View>
          ) : (
            <Text style={{ color: colors.textMuted, textAlign: 'center', paddingVertical: spacing.sm }}>
              {pickup ? 'Pick a drop location to see fare' : 'Set pickup to start'}
            </Text>
          )}

          <Pressable
            onPress={onConfirmBooking}
            disabled={!fare || booking}
            style={({ pressed }) => ({
              backgroundColor: !fare || booking ? '#fed7aa' : colors.primary,
              padding: spacing.lg, borderRadius: radius.lg,
              alignItems: 'center', opacity: pressed ? 0.85 : 1,
            })}
          >
            {booking ? <ActivityIndicator color="white" /> : (
              <Text style={{ color: 'white', fontWeight: '800', fontSize: 16 }}>
                {fare ? `${scheduled ? 'Schedule' : 'Confirm'} · ${formatINR(fare.total)}` : 'Book Ride'}
              </Text>
            )}
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

function FieldRow({ label, value, onChange, onFocus, placeholder, active }: { label: string; value: string; onChange: (s: string) => void; onFocus: () => void; placeholder: string; active: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <View style={{ width: 36, alignItems: 'center' }}>
        <Text style={{ fontSize: 16 }}>{label === 'From' ? '🟢' : '🔴'}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 10, color: colors.textMuted, fontWeight: '700', textTransform: 'uppercase' }}>{label}</Text>
        <TextInput
          value={value}
          onChangeText={onChange}
          onFocus={onFocus}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          style={{ fontSize: 15, color: colors.text, paddingVertical: 2, fontWeight: active ? '700' : '500' }}
        />
      </View>
    </View>
  );
}
