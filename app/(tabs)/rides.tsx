import { useCallback, useState } from 'react';
import { View, Text, FlatList, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { colors, spacing, radius } from '../../lib/theme';
import { formatINR } from '../../lib/fare';

interface Ride {
  id: string;
  pickup: string;
  drop_location: string;
  pickup_at: string;
  vehicle_type: string;
  trip_type: string;
  distance_km: number | null;
  final_fare: number | null;
  status: 'pending' | 'confirmed' | 'completed' | 'cancelled';
  is_scheduled: boolean | null;
  created_at: string;
}

const STATUS_COLOR: Record<Ride['status'], { bg: string; fg: string }> = {
  pending:   { bg: '#fef3c7', fg: '#92400e' },
  confirmed: { bg: '#dbeafe', fg: '#1e40af' },
  completed: { bg: '#d1fae5', fg: '#065f46' },
  cancelled: { bg: '#e5e7eb', fg: '#374151' },
};

export default function Rides() {
  const { user } = useAuth();
  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  async function load() {
    if (!user) return;
    const { data } = await supabase
      .from('bookings')
      .select('id, pickup, drop_location, pickup_at, vehicle_type, trip_type, distance_km, final_fare, status, is_scheduled, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(50);
    setRides((data as Ride[]) ?? []);
    setLoading(false);
    setRefreshing(false);
  }

  useFocusEffect(useCallback(() => { setLoading(true); load(); }, [user?.id]));

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
        keyExtractor={(r) => r.id}
        contentContainerStyle={{ padding: spacing.lg, paddingTop: 0, gap: spacing.md }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
        ListEmptyComponent={
          <View style={{ padding: spacing.xxl, alignItems: 'center' }}>
            <Text style={{ fontSize: 40 }}>🚖</Text>
            <Text style={{ color: colors.textMuted, marginTop: spacing.sm }}>No rides yet. Book your first ride!</Text>
          </View>
        }
        renderItem={({ item }) => {
          const s = STATUS_COLOR[item.status];
          return (
            <View style={{ backgroundColor: 'white', borderRadius: radius.lg, padding: spacing.md, borderWidth: 1, borderColor: colors.border }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.sm }}>
                <View>
                  <Text style={{ fontSize: 12, color: colors.textMuted }}>Booked {new Date(item.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</Text>
                  {item.is_scheduled ? (
                    <Text style={{ fontSize: 12, color: colors.primaryDark, fontWeight: '700', marginTop: 2 }}>
                      📅 Pickup {new Date(item.pickup_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                    </Text>
                  ) : null}
                </View>
                <View style={{ backgroundColor: s.bg, paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill }}>
                  <Text style={{ color: s.fg, fontWeight: '700', fontSize: 11, textTransform: 'uppercase' }}>{item.status}</Text>
                </View>
              </View>
              <Row label="🟢" text={item.pickup} />
              <Row label="🔴" text={item.drop_location} />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border }}>
                <Text style={{ color: colors.textMuted, fontSize: 13 }}>
                  {item.vehicle_type.toUpperCase()} · {item.distance_km ? `${item.distance_km} km` : ''}
                </Text>
                <Text style={{ fontWeight: '800', color: colors.text }}>
                  {item.final_fare != null ? formatINR(item.final_fare) : '—'}
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
