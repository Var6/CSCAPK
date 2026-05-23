import { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, FlatList, ActivityIndicator, Alert, Platform, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from '../../lib/Map';
import * as Location from 'expo-location';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { searchPlaces, routeBetween, type GeocodeResult, type Route } from '../../lib/maps';
import { estimateFare, formatINR, type TripKind, type VehicleKind } from '../../lib/fare';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { colors, spacing, radius } from '../../lib/theme';

const PATNA = { latitude: 25.5941, longitude: 85.1376 };

type Picked = { name: string; lat: number; lng: number } | null;

export default function Home() {
  const { user } = useAuth();
  const mapRef = useRef<MapView>(null);

  const [region, setRegion] = useState({ ...PATNA, latitudeDelta: 0.08, longitudeDelta: 0.08 });
  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [hasLocPerm, setHasLocPerm] = useState(false);

  const [activeField, setActiveField] = useState<'pickup' | 'drop'>('pickup');
  const [pickupText, setPickupText] = useState('');
  const [dropText, setDropText] = useState('');
  const [pickup, setPickup] = useState<Picked>(null);
  const [drop, setDrop] = useState<Picked>(null);
  const [searchOpen, setSearchOpen] = useState(false);

  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [searching, setSearching] = useState(false);

  const [vehicle, setVehicle] = useState<VehicleKind>('car');
  const [tripKind, setTripKind] = useState<TripKind>('city');
  const [passengers] = useState(2);

  const [route, setRoute] = useState<Route | null>(null);
  const [routing, setRouting] = useState(false);
  const [booking, setBooking] = useState(false);

  const [scheduled, setScheduled] = useState(false);
  const [scheduledAt, setScheduledAt] = useState<Date>(() => {
    const d = new Date(); d.setHours(d.getHours() + 2, 0, 0, 0); return d;
  });
  const [iosPicker, setIosPicker] = useState<null | 'date' | 'time'>(null);

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
    setRegion(next);
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

  useEffect(() => {
    if (!pickup || !drop) { setRoute(null); return; }
    setRouting(true);
    routeBetween({ lat: pickup.lat, lng: pickup.lng }, { lat: drop.lat, lng: drop.lng })
      .then((r) => {
        setRoute(r);
        if (r && mapRef.current) {
          mapRef.current.fitToCoordinates(r.geometry, {
            edgePadding: { top: 100, right: 60, bottom: 360, left: 60 },
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
    setSearchOpen(false);
  }

  function clearField(which: 'pickup' | 'drop') {
    if (which === 'pickup') { setPickupText(''); setPickup(null); }
    else { setDropText(''); setDrop(null); }
    setResults([]);
  }

  const fare = route
    ? estimateFare({ distanceKm: route.distanceKm, tripKind, vehicle, discountPct: 0 })
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

    try {
      await api('/api/rides', {
        method: 'POST',
        body: {
          pickup: { address: pickup.name, lat: pickup.lat, lng: pickup.lng },
          dropoff: { address: drop.name, lat: drop.lat, lng: drop.lng },
          tripType: 'one_way',
          scheduledAt: pickupAt.toISOString(),
          paymentMode: 'cash',
          notes: `${vehicle} · ${passengers} pax${scheduled ? ' · scheduled' : ''}`,
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
      [{ text: 'OK' }]
    );
    setDrop(null); setDropText(''); setRoute(null);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <View style={{ flex: 1 }}>
          {/* Map */}
          <MapView
            ref={mapRef}
            style={{ flex: 1 }}
            provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
            initialRegion={region}
            showsUserLocation={hasLocPerm}
            showsMyLocationButton={false}
            showsCompass
            zoomEnabled
            scrollEnabled
            pitchEnabled
            rotateEnabled
            loadingEnabled
            loadingIndicatorColor={colors.primary}
            mapPadding={{ top: 120, right: 0, bottom: 380, left: 0 }}
          >
            {pickup && (
              <Marker coordinate={{ latitude: pickup.lat, longitude: pickup.lng }} title="Pickup" anchor={{ x: 0.5, y: 1 }}>
                <View style={{ alignItems: 'center' }}>
                  <View style={{ backgroundColor: colors.success, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, marginBottom: 4 }}>
                    <Text style={{ color: 'white', fontWeight: '700', fontSize: 11 }}>Pickup</Text>
                  </View>
                  <Ionicons name="location" size={36} color={colors.success} />
                </View>
              </Marker>
            )}
            {drop && (
              <Marker coordinate={{ latitude: drop.lat, longitude: drop.lng }} title="Drop" anchor={{ x: 0.5, y: 1 }}>
                <View style={{ alignItems: 'center' }}>
                  <View style={{ backgroundColor: colors.accent, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, marginBottom: 4 }}>
                    <Text style={{ color: 'white', fontWeight: '700', fontSize: 11 }}>Drop</Text>
                  </View>
                  <Ionicons name="flag" size={36} color={colors.accent} />
                </View>
              </Marker>
            )}
            {route && <Polyline coordinates={route.geometry} strokeColor={colors.primary} strokeWidth={5} />}
          </MapView>

          {/* Search bar — top */}
          <View style={{ position: 'absolute', top: spacing.md, left: spacing.md, right: spacing.md }}>
            <Pressable
              onPress={() => { setSearchOpen(true); setActiveField('pickup'); }}
              style={{ backgroundColor: 'white', borderRadius: radius.lg, padding: spacing.md, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6 }}>
              <FieldRow
                icon={<Ionicons name="radio-button-on" size={18} color={colors.success} />}
                label="From"
                value={pickupText || 'Pickup location'}
                muted={!pickupText}
              />
              <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 8 }} />
              <FieldRow
                icon={<Ionicons name="flag" size={18} color={colors.accent} />}
                label="To"
                value={dropText || 'Where to?'}
                muted={!dropText}
              />
            </Pressable>
          </View>

          {/* Floating: My location button (right side, above bottom sheet) */}
          <Pressable
            onPress={() => fetchCurrentLocation(false)}
            style={({ pressed }) => ({
              position: 'absolute', right: spacing.md, bottom: 400,
              width: 48, height: 48, borderRadius: 24, backgroundColor: 'white',
              alignItems: 'center', justifyContent: 'center',
              shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 6,
              opacity: pressed ? 0.7 : 1,
            })}>
            <Ionicons name="locate" size={22} color={colors.primary} />
          </Pressable>

          {/* Bottom sheet */}
          <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'white', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.lg, gap: spacing.sm, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 16, elevation: 10 }}>

            {/* Drag handle */}
            <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: '#d1d5db', marginBottom: 4 }} />

            {/* Vehicle */}
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
              {(['car', 'traveler', 'bus'] as VehicleKind[]).map((v) => (
                <Pressable
                  key={v}
                  onPress={() => setVehicle(v)}
                  style={({ pressed }) => ({
                    flex: 1, paddingVertical: spacing.sm, borderRadius: radius.md,
                    borderWidth: 2,
                    borderColor: vehicle === v ? colors.primary : colors.border,
                    backgroundColor: vehicle === v ? colors.primaryLight : 'white',
                    alignItems: 'center', opacity: pressed ? 0.7 : 1,
                  })}>
                  <Ionicons
                    name={v === 'car' ? 'car-sport' : v === 'bus' ? 'bus' : 'car'}
                    size={22}
                    color={vehicle === v ? colors.primaryDark : colors.text}
                  />
                  <Text style={{ marginTop: 2, fontWeight: '700', color: vehicle === v ? colors.primaryDark : colors.text, fontSize: 11 }}>
                    {v === 'car' ? 'Car' : v === 'bus' ? 'Bus' : 'Traveler'}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Schedule toggle */}
            <View style={{ flexDirection: 'row', gap: spacing.xs }}>
              <Pressable
                onPress={() => setScheduled(false)}
                style={{ flex: 1, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: !scheduled ? colors.primary : '#f3f4f6', alignItems: 'center' }}>
                <Text style={{ color: !scheduled ? 'white' : colors.text, fontWeight: '700', fontSize: 12 }}>Ride now</Text>
              </Pressable>
              <Pressable
                onPress={() => setScheduled(true)}
                style={{ flex: 1, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: scheduled ? colors.primary : '#f3f4f6', alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 4 }}>
                <Ionicons name="calendar" size={14} color={scheduled ? 'white' : colors.text} />
                <Text style={{ color: scheduled ? 'white' : colors.text, fontWeight: '700', fontSize: 12 }}>Schedule</Text>
              </Pressable>
            </View>

            {scheduled && (
              <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <Pressable
                  onPress={() => Platform.OS === 'android' ? openAndroidPicker('date') : setIosPicker('date')}
                  style={{ flex: 1, padding: 10, borderRadius: radius.md, borderWidth: 2, borderColor: colors.border, backgroundColor: 'white' }}>
                  <Text style={{ fontSize: 10, color: colors.textMuted, fontWeight: '700', textTransform: 'uppercase' }}>Date</Text>
                  <Text style={{ fontSize: 14, color: colors.text, fontWeight: '700' }}>
                    {scheduledAt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => Platform.OS === 'android' ? openAndroidPicker('time') : setIosPicker('time')}
                  style={{ flex: 1, padding: 10, borderRadius: radius.md, borderWidth: 2, borderColor: colors.border, backgroundColor: 'white' }}>
                  <Text style={{ fontSize: 10, color: colors.textMuted, fontWeight: '700', textTransform: 'uppercase' }}>Time</Text>
                  <Text style={{ fontSize: 14, color: colors.text, fontWeight: '700' }}>
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
              <View style={{ padding: spacing.sm, alignItems: 'center' }}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : fare && route ? (
              <View style={{ backgroundColor: colors.primaryLight, padding: spacing.sm, borderRadius: radius.md, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View>
                  <Text style={{ color: colors.textMuted, fontSize: 11 }}>{route.distanceKm.toFixed(1)} km · ~{Math.round(route.durationMin)} min</Text>
                  <Text style={{ fontSize: 22, fontWeight: '800', color: colors.text }}>{formatINR(fare.total)}</Text>
                </View>
                <Text style={{ color: colors.textMuted, fontSize: 11, maxWidth: 120, textAlign: 'right' }}>
                  Estimated · toll extra
                </Text>
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
                padding: spacing.md, borderRadius: radius.lg,
                alignItems: 'center', opacity: pressed ? 0.85 : 1,
              })}>
              {booking ? <ActivityIndicator color="white" /> : (
                <Text style={{ color: 'white', fontWeight: '800', fontSize: 15 }}>
                  {fare ? `${scheduled ? 'Schedule' : 'Book'} · ${formatINR(fare.total)}` : 'Book Ride'}
                </Text>
              )}
            </Pressable>
          </View>

          {/* Full-screen search overlay */}
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
                    icon={<Ionicons name="radio-button-on" size={20} color={colors.success} />}
                    placeholder="Pickup location"
                    value={pickupText}
                    onChange={setPickupText}
                    onFocus={() => setActiveField('pickup')}
                    onClear={() => clearField('pickup')}
                    active={activeField === 'pickup'}
                  />
                  <InputRow
                    icon={<Ionicons name="flag" size={20} color={colors.accent} />}
                    placeholder="Drop location"
                    value={dropText}
                    onChange={setDropText}
                    onFocus={() => setActiveField('drop')}
                    onClear={() => clearField('drop')}
                    active={activeField === 'drop'}
                    autoFocus
                  />

                  <Pressable
                    onPress={async () => {
                      await fetchCurrentLocation(true);
                      setActiveField('drop');
                    }}
                    style={({ pressed }) => ({
                      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
                      paddingVertical: spacing.sm, opacity: pressed ? 0.6 : 1,
                    })}>
                    <Ionicons name="locate" size={20} color={colors.primary} />
                    <Text style={{ color: colors.primary, fontWeight: '700' }}>Use current location</Text>
                  </Pressable>
                </View>

                {searching && <ActivityIndicator color={colors.primary} style={{ marginTop: 12 }} />}

                <FlatList
                  data={results}
                  keyExtractor={(r, i) => r.display_name + i}
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={{ padding: spacing.md }}
                  renderItem={({ item }) => (
                    <Pressable onPress={() => pickResult(item)} style={({ pressed }) => ({ paddingVertical: spacing.sm, flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, opacity: pressed ? 0.6 : 1 })}>
                      <Ionicons name="location-outline" size={20} color={colors.textMuted} style={{ marginTop: 2 }} />
                      <Text style={{ flex: 1, color: colors.text }} numberOfLines={2}>{item.display_name}</Text>
                    </Pressable>
                  )}
                  ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: colors.border }} />}
                  ListEmptyComponent={
                    !searching ? (
                      <Text style={{ color: colors.textMuted, textAlign: 'center', marginTop: 32, fontSize: 13 }}>
                        Start typing a destination
                      </Text>
                    ) : null
                  }
                />

                {pickup && drop && (
                  <View style={{ padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border }}>
                    <Pressable
                      onPress={() => setSearchOpen(false)}
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

function FieldRow({ icon, label, value, muted }: { icon: React.ReactNode; label: string; value: string; muted?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
      <View style={{ width: 28, alignItems: 'center' }}>{icon}</View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 10, color: colors.textMuted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</Text>
        <Text numberOfLines={1} style={{ fontSize: 14, color: muted ? colors.textMuted : colors.text, fontWeight: '600' }}>{value}</Text>
      </View>
    </View>
  );
}

function InputRow({ icon, placeholder, value, onChange, onFocus, onClear, active, autoFocus }: {
  icon: React.ReactNode;
  placeholder: string;
  value: string;
  onChange: (s: string) => void;
  onFocus: () => void;
  onClear: () => void;
  active: boolean;
  autoFocus?: boolean;
}) {
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
      borderWidth: 2, borderColor: active ? colors.primary : colors.border,
      borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: 4, backgroundColor: 'white',
    }}>
      {icon}
      <TextInput
        value={value}
        onChangeText={onChange}
        onFocus={onFocus}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        autoFocus={autoFocus}
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
