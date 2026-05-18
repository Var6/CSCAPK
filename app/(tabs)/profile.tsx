import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';
import { colors, spacing, radius } from '../../lib/theme';

export default function Profile() {
  const { user, profile, refreshProfile, signOut } = useAuth();
  const [fullName, setFullName] = useState(profile?.full_name ?? '');
  const [phone, setPhone] = useState(profile?.phone ?? '');
  const [promocode, setPromocode] = useState(profile?.promocode ?? '');
  const [saving, setSaving] = useState(false);
  const [pcMsg, setPcMsg] = useState('');

  async function save() {
    if (!user) return;
    setSaving(true);

    // Look up the promocode if user typed/changed it.
    let discount_pct = profile?.discount_pct ?? 0;
    let pcode: string | null = promocode.trim().toUpperCase() || null;
    if (pcode && pcode !== profile?.promocode) {
      const { data } = await supabase
        .from('promocodes')
        .select('discount_pct')
        .eq('code', pcode)
        .eq('active', true)
        .maybeSingle();
      if (data) {
        discount_pct = data.discount_pct;
        setPcMsg(`✓ ${data.discount_pct}% off applied to future rides`);
      } else {
        setSaving(false);
        setPcMsg('Invalid or expired code');
        return;
      }
    } else if (!pcode) {
      discount_pct = 0;
    }

    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: fullName.trim() || null,
        phone: phone.replace(/\s+/g, '') || null,
        promocode: pcode,
        discount_pct,
      })
      .eq('id', user.id);

    setSaving(false);
    if (error) { Alert.alert('Could not save', error.message); return; }
    await refreshProfile();
    if (!pcMsg) Alert.alert('Saved', 'Profile updated.');
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bgSoft }}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg }}>

        <View style={{ alignItems: 'center', marginBottom: spacing.xl }}>
          <View style={{ width: 80, height: 80, borderRadius: 40, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm }}>
            <Text style={{ color: 'white', fontSize: 30, fontWeight: '900' }}>
              {(profile?.full_name || user?.email || '?').charAt(0).toUpperCase()}
            </Text>
          </View>
          <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text }}>{profile?.full_name || 'Welcome'}</Text>
          <Text style={{ color: colors.textMuted }}>{user?.email}</Text>
          {profile && profile.discount_pct > 0 && (
            <View style={{ marginTop: spacing.sm, backgroundColor: colors.primaryLight, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.pill }}>
              <Text style={{ color: colors.primaryDark, fontWeight: '700' }}>{profile.discount_pct}% off active ({profile.promocode})</Text>
            </View>
          )}
        </View>

        <Card title="Personal details">
          <Label>Full name</Label>
          <TextInput value={fullName} onChangeText={setFullName} style={inputStyle} placeholder="Your name" placeholderTextColor={colors.textMuted} />

          <Label>Phone</Label>
          <TextInput value={phone} onChangeText={setPhone} keyboardType="phone-pad" style={inputStyle} placeholder="+91 9XXXXXXXXX" placeholderTextColor={colors.textMuted} />
        </Card>

        <Card title="Promocode">
          <Text style={{ color: colors.textMuted, marginBottom: spacing.sm, fontSize: 13 }}>
            Have a code? Add it here to get a percentage off every ride you book.
          </Text>
          <TextInput
            value={promocode}
            onChangeText={(t) => { setPromocode(t.toUpperCase()); setPcMsg(''); }}
            autoCapitalize="characters"
            style={inputStyle}
            placeholder="e.g. CSC20"
            placeholderTextColor={colors.textMuted}
          />
          {pcMsg ? (
            <Text style={{ marginTop: spacing.xs, color: pcMsg.startsWith('✓') ? colors.success : colors.error }}>{pcMsg}</Text>
          ) : null}
        </Card>

        <Pressable
          onPress={save}
          disabled={saving}
          style={({ pressed }) => ({
            backgroundColor: saving ? colors.primaryLight : colors.primary,
            padding: spacing.lg, borderRadius: radius.lg, alignItems: 'center', opacity: pressed ? 0.85 : 1,
            marginTop: spacing.md,
          })}
        >
          {saving ? <ActivityIndicator color="white" /> : <Text style={{ color: 'white', fontWeight: '800', fontSize: 16 }}>Save Changes</Text>}
        </Pressable>

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
function Label({ children }: { children: React.ReactNode }) {
  return <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textMuted, marginBottom: 4, marginTop: spacing.sm }}>{children}</Text>;
}
const inputStyle = {
  borderWidth: 2, borderColor: colors.border, borderRadius: radius.md,
  padding: spacing.md, fontSize: 16, color: colors.text, backgroundColor: 'white',
};
