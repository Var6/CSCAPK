import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../lib/auth';
import { colors, spacing, radius } from '../../lib/theme';

export default function Profile() {
  const { user, signOut } = useAuth();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgSoft }}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>

        <View style={{ alignItems: 'center', marginBottom: spacing.xl }}>
          <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm }}>
            <Text style={{ color: 'white', fontSize: 30, fontWeight: '900' }}>
              {(user?.name || user?.phone || '?').charAt(0).toUpperCase()}
            </Text>
          </View>
          <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text }}>{user?.name || 'Welcome'}</Text>
          {user?.email ? <Text style={{ color: colors.textMuted }}>{user.email}</Text> : null}
          {user?.phone ? <Text style={{ color: colors.textMuted }}>{user.phone}</Text> : null}
        </View>

        <Card title="Account">
          <Row label="Name" value={user?.name ?? '—'} />
          <Row label="Phone" value={user?.phone ?? '—'} />
          <Row label="Email" value={user?.email ?? '—'} />
          <Row label="Address" value={user?.address ?? '—'} />
          <Row label="Total rides" value={String(user?.totalRides ?? 0)} />
        </Card>

        <Pressable
          onPress={() => signOut()}
          style={({ pressed }) => ({
            marginTop: spacing.md, padding: spacing.lg, borderRadius: radius.lg,
            borderWidth: 1, borderColor: colors.border, alignItems: 'center', opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text style={{ color: colors.error, fontWeight: '700' }}>Sign Out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ backgroundColor: 'white', borderRadius: radius.lg, padding: spacing.lg, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border }}>
      <Text style={{ fontSize: 13, fontWeight: '800', textTransform: 'uppercase', color: colors.textMuted, marginBottom: spacing.sm, letterSpacing: 1 }}>{title}</Text>
      {children}
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}>
      <Text style={{ color: colors.textMuted }}>{label}</Text>
      <Text style={{ color: colors.text, fontWeight: '600', maxWidth: '60%', textAlign: 'right' }}>{value}</Text>
    </View>
  );
}
