import { useCallback, useState } from 'react';
import { View, Text, FlatList, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '../../lib/auth';
import { api, BILLING_URL } from '../../lib/api';
import { colors, spacing, radius } from '../../lib/theme';
import { formatINR } from '../../lib/fare';

interface Ride {
  _id: string;
  tripNumber?: string;
  pickup: { address: string };
  dropoff: { address: string };
  vehicleType: string;
  // Mirrors CSCBilling's Trip.status: a driver has claimed it ("accepted"),
  // is driving it ("ongoing"), or it is done.
  status: 'pending' | 'accepted' | 'ongoing' | 'completed' | 'cancelled';
  fare: number;
  distance: number;
  otp?: string;
  endOtp?: string;
  paymentMode?: string;
  paymentStatus?: string;
  scheduledAt?: string;
  createdAt: string;
  driver?: { name?: string; phone?: string; vehicleNumber?: string; vehicleModel?: string } | null;
}

const STATUS_COLOR: Record<Ride['status'], { bg: string; fg: string }> = {
  pending:   { bg: '#fef3c7', fg: '#92400e' },
  accepted:  { bg: '#dbeafe', fg: '#1e40af' },
  ongoing:   { bg: '#fde68a', fg: '#92400e' },
  completed: { bg: '#d1fae5', fg: '#065f46' },
  cancelled: { bg: '#e5e7eb', fg: '#374151' },
};

/** Riders should not have to read our internal state names. */
const STATUS_LABEL: Record<Ride['status'], string> = {
  pending:   'Finding driver',
  accepted:  'Driver assigned',
  ongoing:   'On the way',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export default function Rides() {
  const { user } = useAuth();
  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    if (!user) return;
    try {
      const data = await api<{ rides: Ride[] }>('/api/customer/rides', { baseUrl: BILLING_URL });
      setRides(data.rides ?? []);
    } catch {
      setRides([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [user?._id]));

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgSoft, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgSoft }}>
      <View style={{ padding: spacing.lg, paddingBottom: spacing.sm }}>
        <Text style={{ fontSize: 24, fontWeight: '800', color: colors.text }}>My Rides</Text>
      </View>
      <FlatList
        data={rides}
        keyExtractor={(r) => r._id}
        contentContainerStyle={{ padding: spacing.lg, paddingTop: 0, gap: spacing.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
        ListEmptyComponent={
          <View style={{ padding: spacing.xxl, alignItems: 'center' }}>
            <Text style={{ fontSize: 40 }}>🚖</Text>
            <Text style={{ color: colors.textMuted, marginTop: spacing.sm }}>No rides yet. Book your first ride!</Text>
          </View>
        }
        renderItem={({ item }) => {
          const s = STATUS_COLOR[item.status] ?? STATUS_COLOR.pending;
          const scheduled = !!item.scheduledAt && new Date(item.scheduledAt).getTime() > new Date(item.createdAt).getTime() + 30 * 60 * 1000;
          return (
            <View style={{ backgroundColor: 'white', borderRadius: radius.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.border }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.sm }}>
                <View>
                  <Text style={{ fontSize: 12, color: colors.textMuted }}>Booked {new Date(item.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</Text>
                  {scheduled ? (
                    <Text style={{ fontSize: 12, color: colors.primaryDark, fontWeight: '700', marginTop: 2 }}>
                      📅 Pickup {new Date(item.scheduledAt!).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                    </Text>
                  ) : null}
                </View>
                <View style={{ backgroundColor: s.bg, paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill }}>
                  <Text style={{ color: s.fg, fontWeight: '700', fontSize: 11, textTransform: 'uppercase' }}>
                    {STATUS_LABEL[item.status] ?? item.status}
                  </Text>
                </View>
              </View>
              <Row label="🟢" text={item.pickup?.address ?? ''} />
              <Row label="🔴" text={item.dropoff?.address ?? ''} />

              {/* Handoff codes. Share the START code to begin; the END code is
                  only needed if the driver has to end before the destination. */}
              {(item.status === 'pending' || item.status === 'accepted') && item.otp ? (
                <OtpBar
                  label="Share this OTP with your driver to START the ride"
                  code={item.otp}
                  tone="start"
                />
              ) : null}
              {item.status === 'ongoing' && item.endOtp ? (
                <OtpBar
                  label="Only share this END OTP if the driver ends before your destination"
                  code={item.endOtp}
                  tone="end"
                />
              ) : null}

              {item.driver?.name ? (
                <Text style={{ marginTop: spacing.sm, color: colors.textMuted, fontSize: 12 }}>
                  Driver: {item.driver.name} {item.driver.vehicleNumber ? `· ${item.driver.vehicleNumber}` : ''}
                </Text>
              ) : null}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
                <Text style={{ color: colors.textMuted, fontSize: 13 }}>
                  {item.vehicleType?.toUpperCase()} · {item.distance ? `${item.distance} km` : ''}
                </Text>
                <Text style={{ fontWeight: '800', color: colors.text }}>
                  {item.fare ? formatINR(item.fare) : '—'}
                </Text>
              </View>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

function Row({ label, text }: { label: string; text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 4 }}>
      <Text>{label}</Text>
      <Text style={{ flex: 1, color: colors.text }} numberOfLines={1}>{text}</Text>
    </View>
  );
}

function OtpBar({ label, code, tone }: { label: string; code: string; tone: 'start' | 'end' }) {
  const bg = tone === 'start' ? colors.primaryLight : '#fef3c7';
  const fg = tone === 'start' ? colors.primaryDark : '#92400e';
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      backgroundColor: bg, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
      marginTop: spacing.sm, gap: spacing.sm,
    }}>
      <Text style={{ flex: 1, fontSize: 11, color: fg, fontWeight: '600' }}>{label}</Text>
      <Text style={{ fontSize: 22, fontWeight: '900', color: fg, letterSpacing: 4 }}>{code}</Text>
    </View>
  );
}
