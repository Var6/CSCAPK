import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, Alert, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Marker, mapProvider } from '../../lib/Map';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { useRates } from '../../lib/useRates';
import { availablePackages, formatWindow, quoteRental, rentalVehicles } from '../../lib/rental';
import { formatINR } from '../../lib/fare';
import type { RentalHub, RiderTier, VehicleClass } from '../../lib/rates';
import { api, BILLING_URL } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { colors, spacing, radius } from '../../lib/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

// Rentals ride the existing bookings pipeline until CSCBilling exposes a
// dedicated endpoint. Point this at '/api/rentals' once that ships.
const RENTAL_ENDPOINT = '/api/customer/rides';

const TIERS: RiderTier[] = ['public', 'member', 'official'];

/** Next round hour, at least 1h out — vehicles need prep time at the hub. */
function defaultStart(): Date {
  const d = new Date();
  d.setHours(d.getHours() + 1, 0, 0, 0);
  return d;
}

export default function Rental() {
  const { user } = useAuth();
  const { rates } = useRates();
  const mapRef = useRef<MapView>(null);

  const vehicleIds = useMemo(() => rentalVehicles(rates), [rates]);
  const vehicles = useMemo(
    () => rates.vehicles.filter((v) => vehicleIds.includes(v.id)),
    [rates.vehicles, vehicleIds],
  );

  const [vehicle, setVehicle] = useState<VehicleClass>('hatchback');
  const [hub, setHub] = useState<RentalHub | null>(null);
  const [packageId, setPackageId] = useState('');
  const [startAt, setStartAt] = useState<Date>(defaultStart);
  const [extraHours, setExtraHours] = useState(0);
  const [estimatedKm, setEstimatedKm] = useState(0);
  const [tier, setTier] = useState<RiderTier>('public');
  const [iosPicker, setIosPicker] = useState<null | 'date' | 'time'>(null);
  const [booking, setBooking] = useState(false);

  const packages = useMemo(() => availablePackages(rates, vehicle), [rates, vehicle]);

  // Defaults, and repair after the fleet/packages change under us.
  useEffect(() => {
    if (vehicles.length && !vehicles.some((v) => v.id === vehicle)) setVehicle(vehicles[0].id);
  }, [vehicles, vehicle]);

  useEffect(() => {
    if (packages.length && !packages.some((p) => p.id === packageId)) setPackageId(packages[0].id);
  }, [packages, packageId]);

  useEffect(() => {
    if (!hub && rates.rental.hubs.length) setHub(rates.rental.hubs[0]);
  }, [rates.rental.hubs, hub]);

  // Included km is the sensible starting estimate for the extra-km preview.
  const selectedPkg = packages.find((p) => p.id === packageId) ?? null;
  useEffect(() => {
    if (selectedPkg) setEstimatedKm(selectedPkg.includedKm);
  }, [selectedPkg?.id]);

  const endAt = useMemo(() => {
    const hours = (selectedPkg?.hours ?? 0) + extraHours;
    return new Date(startAt.getTime() + hours * 3_600_000);
  }, [startAt, selectedPkg, extraHours]);

  const quote = useMemo(
    () => quoteRental({ rates, vehicle, packageId, startAt, endAt, estimatedKm, tier }),
    [rates, vehicle, packageId, startAt, endAt, estimatedKm, tier],
  );

  function openAndroidPicker(mode: 'date' | 'time') {
    DateTimePickerAndroid.open({
      value: startAt, mode, minimumDate: new Date(), is24Hour: false,
      onChange: (_, selected) => {
        if (!selected) return;
        const next = new Date(startAt);
        if (mode === 'date') next.setFullYear(selected.getFullYear(), selected.getMonth(), selected.getDate());
        else next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
        setStartAt(next);
      },
    });
  }

  function focusHub(h: RentalHub) {
    setHub(h);
    mapRef.current?.animateToRegion(
      { latitude: h.lat, longitude: h.lng, latitudeDelta: 0.03, longitudeDelta: 0.03 },
      500,
    );
  }

  async function onBook() {
    if (!user || !hub || !selectedPkg || quote.unavailableReason) return;
    if (startAt.getTime() < Date.now() + 30 * 60 * 1000) {
      Alert.alert('Pick a later slot', 'Self-drive bookings need at least 30 minutes of prep time at the hub.');
      return;
    }

    setBooking(true);
    try {
      await api(RENTAL_ENDPOINT, {
        baseUrl: BILLING_URL,
        method: 'POST',
        body: {
          pickup: { address: `${hub.name}, ${hub.address}`, lat: hub.lat, lng: hub.lng },
          dropoff: { address: `Return to ${hub.name}`, lat: hub.lat, lng: hub.lng },
          tripType: 'one_way',
          scheduledAt: startAt.toISOString(),
          paymentMode: 'cash',
          vehicleType: vehicle,
          distance: estimatedKm,
          fareEstimate: quote.total,
          // Rental-specific payload for CSCBilling.
          bookingKind: 'self_drive_rental',
          rental: {
            hubId: hub.id,
            packageId: selectedPkg.id,
            startAt: startAt.toISOString(),
            endAt: endAt.toISOString(),
            includedKm: quote.includedKm,
            estimatedKm,
            extraHours: quote.extraHours,
            securityDeposit: quote.securityDeposit,
          },
          riderTier: tier,
          rateVersion: rates.version,
          notes: `SELF-DRIVE · ${selectedPkg.label} · ${vehicle} · ${hub.name} · ${formatWindow(startAt, endAt)}`
            + (quote.discountPct > 0 ? ` · ${quote.discountLabel} ${quote.discountPct}%` : ''),
        },
      });
    } catch (e: any) {
      setBooking(false);
      Alert.alert('Booking failed', e.message ?? 'Try again');
      return;
    }

    setBooking(false);
    Alert.alert(
      'Self-drive booked!',
      `${selectedPkg.label} ${vehicle} from ${hub.name}.\n${formatWindow(startAt, endAt)}\n\n`
      + `Carry your licence and ID. ${formatINR(quote.securityDeposit)} refundable deposit is collected at pickup.`,
      [{ text: 'OK' }],
    );
  }

  if (!vehicles.length) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgSoft, alignItems: 'center', justifyContent: 'center', padding: spacing.xl }}>
        <Ionicons name="key-outline" size={40} color={colors.textMuted} />
        <Text style={{ color: colors.textMuted, marginTop: spacing.sm, textAlign: 'center' }}>
          Self-drive is not available right now. Please check back later.
        </Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgSoft }} edges={['top']}>
      <ScrollView contentContainerStyle={{ paddingBottom: spacing.xxl }} showsVerticalScrollIndicator={false}>

        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm }}>
          <Text style={{ fontSize: 24, fontWeight: '800', color: colors.text }}>Self Drive</Text>
          <Text style={{ color: colors.textMuted, fontSize: 13 }}>
            Vehicle only — you drive. Pick it up from a CSC hub.
          </Text>
        </View>

        {/* Hubs */}
        <Card title="Pickup hub">
          <View style={{ height: 160, borderRadius: radius.md, overflow: 'hidden', marginBottom: spacing.sm }}>
            <MapView
              ref={mapRef}
              style={{ flex: 1 }}
              provider={mapProvider}
              initialRegion={{
                latitude: hub?.lat ?? rates.rental.hubs[0]?.lat ?? 25.5941,
                longitude: hub?.lng ?? rates.rental.hubs[0]?.lng ?? 85.1376,
                latitudeDelta: 0.06, longitudeDelta: 0.06,
              }}
              scrollEnabled={false}
              zoomEnabled={false}
            >
              {rates.rental.hubs.map((h) => (
                <Marker
                  key={h.id}
                  coordinate={{ latitude: h.lat, longitude: h.lng }}
                  title={h.name}
                  onPress={() => focusHub(h)}
                  pinColor={hub?.id === h.id ? undefined : 'grey'}
                />
              ))}
            </MapView>
          </View>

          {rates.rental.hubs.map((h) => {
            const on = hub?.id === h.id;
            return (
              <Pressable
                key={h.id}
                onPress={() => focusHub(h)}
                style={({ pressed }) => ({
                  flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
                  padding: spacing.sm, borderRadius: radius.md, marginBottom: 6,
                  borderWidth: 2, borderColor: on ? colors.primary : colors.border,
                  backgroundColor: on ? colors.primaryLight : 'white', opacity: pressed ? 0.7 : 1,
                })}>
                <Ionicons name={on ? 'location' : 'location-outline'} size={20} color={on ? colors.primaryDark : colors.textMuted} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '700', color: colors.text, fontSize: 13 }}>{h.name}</Text>
                  <Text style={{ color: colors.textMuted, fontSize: 11 }} numberOfLines={1}>{h.address}</Text>
                </View>
                <Text style={{ color: colors.textMuted, fontSize: 10 }}>{h.opensAt}–{h.closesAt}</Text>
              </Pressable>
            );
          })}
        </Card>

        {/* Vehicle */}
        <Card title="Vehicle">
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {vehicles.map((v) => {
              const on = vehicle === v.id;
              const cheapest = rates.rental.packages
                .map((p) => p.price[v.id])
                .filter((n): n is number => typeof n === 'number');
              return (
                <Pressable
                  key={v.id}
                  onPress={() => setVehicle(v.id)}
                  style={({ pressed }) => ({
                    flex: 1, padding: spacing.sm, borderRadius: radius.md,
                    borderWidth: 2, borderColor: on ? colors.primary : colors.border,
                    backgroundColor: on ? colors.primaryLight : 'white',
                    alignItems: 'center', opacity: pressed ? 0.7 : 1,
                  })}>
                  <Ionicons name={v.icon as IconName} size={24} color={on ? colors.primaryDark : colors.text} />
                  <Text style={{ marginTop: 2, fontWeight: '700', fontSize: 12, color: on ? colors.primaryDark : colors.text }}>{v.label}</Text>
                  <Text numberOfLines={1} style={{ fontSize: 9, color: colors.textMuted }}>{v.examples}</Text>
                  {cheapest.length > 0 && (
                    <Text style={{ fontSize: 10, color: colors.textMuted, marginTop: 2 }}>
                      from {formatINR(Math.min(...cheapest))}
                    </Text>
                  )}
                  <Text style={{ fontSize: 9, color: colors.textMuted }}>{v.seats} seats</Text>
                </Pressable>
              );
            })}
          </View>
        </Card>

        {/* Package */}
        <Card title="Package">
          {packages.map((p) => {
            const on = packageId === p.id;
            const price = p.price[vehicle]!;
            return (
              <Pressable
                key={p.id}
                onPress={() => { setPackageId(p.id); setExtraHours(0); }}
                style={({ pressed }) => ({
                  flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
                  padding: spacing.md, borderRadius: radius.md, marginBottom: 6,
                  borderWidth: 2, borderColor: on ? colors.primary : colors.border,
                  backgroundColor: on ? colors.primaryLight : 'white', opacity: pressed ? 0.7 : 1,
                })}>
                <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={20} color={on ? colors.primary : colors.textMuted} />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontWeight: '800', color: colors.text }}>{p.label}</Text>
                  <Text style={{ color: colors.textMuted, fontSize: 11 }}>
                    {p.includedKm} km included · ₹{rates.rental.extraKm[vehicle] ?? '—'}/km after
                  </Text>
                </View>
                <Text style={{ fontWeight: '800', color: colors.text }}>{formatINR(price)}</Text>
              </Pressable>
            );
          })}
        </Card>

        {/* Slot */}
        <Card title="Pickup time">
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <PickerButton
              label="Date"
              value={startAt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
              onPress={() => Platform.OS === 'android' ? openAndroidPicker('date') : setIosPicker('date')}
            />
            <PickerButton
              label="Time"
              value={startAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
              onPress={() => Platform.OS === 'android' ? openAndroidPicker('time') : setIosPicker('time')}
            />
          </View>

          {Platform.OS === 'ios' && iosPicker && (
            <DateTimePicker
              value={startAt}
              mode={iosPicker}
              display="spinner"
              minimumDate={new Date()}
              onChange={(_, selected) => { setIosPicker(null); if (selected) setStartAt(selected); }}
            />
          )}

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '700', color: colors.text, fontSize: 13 }}>Keep it longer</Text>
              <Text style={{ color: colors.textMuted, fontSize: 11 }}>
                ₹{rates.rental.extraHour[vehicle] ?? '—'} per extra hour
              </Text>
            </View>
            <Stepper value={extraHours} onChange={setExtraHours} />
          </View>

          <View style={{ marginTop: spacing.sm, padding: spacing.sm, backgroundColor: colors.bgSoft, borderRadius: radius.md }}>
            <Text style={{ fontSize: 12, color: colors.text, fontWeight: '700' }}>{formatWindow(startAt, endAt)}</Text>
            <Text style={{ fontSize: 11, color: colors.textMuted }}>{quote.bookedHours.toFixed(0)} hours total</Text>
          </View>
        </Card>

        {/* Distance estimate */}
        <Card title="How far will you drive?">
          <View style={{ flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' }}>
            {[0, 0.5, 1, 1.5, 2].map((mult) => {
              const value = Math.round((quote.includedKm || 100) * mult);
              const on = estimatedKm === value;
              return (
                <Pressable
                  key={mult}
                  onPress={() => setEstimatedKm(value)}
                  style={({ pressed }) => ({
                    paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.pill,
                    borderWidth: 2, borderColor: on ? colors.primary : colors.border,
                    backgroundColor: on ? colors.primaryLight : 'white', opacity: pressed ? 0.7 : 1,
                  })}>
                  <Text style={{ fontSize: 12, fontWeight: '700', color: on ? colors.primaryDark : colors.text }}>
                    {value} km
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 6 }}>
            Only for the estimate — you pay for actual km on the odometer at return.
          </Text>
        </Card>

        {/* Tier */}
        <Card title="Fare category">
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
                  <Text numberOfLines={1} style={{ fontWeight: '700', fontSize: 11, color: on ? colors.primaryDark : colors.text }}>{cfg.label}</Text>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: cfg.pct > 0 ? colors.success : colors.textMuted }}>
                    {cfg.pct > 0 ? `${cfg.pct}% off` : 'No discount'}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Card>

        {/* Requirements */}
        <Card title="Before you book">
          {rates.rental.requirements.map((r, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start', marginBottom: 4 }}>
              <Ionicons name="checkmark-circle" size={16} color={colors.success} style={{ marginTop: 1 }} />
              <Text style={{ flex: 1, color: colors.text, fontSize: 12 }}>{r}</Text>
            </View>
          ))}
        </Card>

        {/* Quote */}
        <Card title="Fare summary">
          {quote.unavailableReason ? (
            <Text style={{ color: colors.error, fontSize: 13 }}>{quote.unavailableReason}</Text>
          ) : (
            <>
              {quote.baseLines.map((l, i) => (
                <Row key={i} label={l.label} detail={l.detail} amount={formatINR(l.amount)} />
              ))}
              {quote.discountAmount > 0 && (
                <Row label={`${quote.discountLabel} discount`} detail={`${quote.discountPct}% on base fare`} amount={`− ${formatINR(quote.discountAmount)}`} good />
              )}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6, paddingTop: 6, borderTopWidth: 1, borderTopColor: colors.border }}>
                <Text style={{ fontWeight: '800', color: colors.text }}>Payable now</Text>
                <Text style={{ fontWeight: '800', color: colors.text, fontSize: 16 }}>{formatINR(quote.total)}</Text>
              </View>
              <Row label="Security deposit" detail="refundable at return" amount={formatINR(quote.securityDeposit)} />
              {quote.notes.map((n, i) => (
                <Text key={`n${i}`} style={{ fontSize: 10, color: colors.textMuted, marginTop: 3 }}>• {n}</Text>
              ))}
            </>
          )}
        </Card>

        <View style={{ paddingHorizontal: spacing.lg }}>
          <Pressable
            onPress={onBook}
            disabled={booking || !!quote.unavailableReason || !hub}
            style={({ pressed }) => ({
              backgroundColor: booking || quote.unavailableReason || !hub ? '#fed7aa' : colors.primary,
              padding: spacing.md, borderRadius: radius.lg, alignItems: 'center', opacity: pressed ? 0.85 : 1,
            })}>
            {booking ? <ActivityIndicator color="white" /> : (
              <Text style={{ color: 'white', fontWeight: '800', fontSize: 15 }}>
                Book self-drive · {formatINR(quote.total)}
              </Text>
            )}
          </Pressable>
          <Text style={{ textAlign: 'center', fontSize: 9, color: colors.textMuted, marginTop: 6 }}>
            Rate card {rates.version}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{
      backgroundColor: 'white', borderRadius: radius.lg, padding: spacing.lg,
      marginHorizontal: spacing.lg, marginBottom: spacing.md,
      borderWidth: 1, borderColor: colors.border,
    }}>
      <Text style={{ fontSize: 11, fontWeight: '800', textTransform: 'uppercase', color: colors.textMuted, marginBottom: spacing.sm, letterSpacing: 0.8 }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

function Row({ label, detail, amount, good }: { label: string; detail?: string; amount: string; good?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: 2 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 13, color: colors.text }}>{label}</Text>
        {!!detail && <Text style={{ fontSize: 10, color: colors.textMuted }}>{detail}</Text>}
      </View>
      <Text style={{ fontSize: 13, fontWeight: '700', color: good ? colors.success : colors.text }}>{amount}</Text>
    </View>
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

function PickerButton({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ flex: 1, padding: 10, borderRadius: radius.md, borderWidth: 2, borderColor: colors.border, backgroundColor: 'white' }}>
      <Text style={{ fontSize: 10, color: colors.textMuted, fontWeight: '700', textTransform: 'uppercase' }}>{label}</Text>
      <Text style={{ fontSize: 14, color: colors.text, fontWeight: '700' }}>{value}</Text>
    </Pressable>
  );
}
