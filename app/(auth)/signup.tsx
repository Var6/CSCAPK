import { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Link } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { colors, spacing, radius } from '../../lib/theme';

export default function Signup() {
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [promocode, setPromocode] = useState('');
  const [pcValid, setPcValid] = useState<null | { pct: number } | { error: string }>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function checkPromocode() {
    const code = promocode.trim().toUpperCase();
    if (!code) { setPcValid(null); return; }
    const { data } = await supabase
      .from('promocodes')
      .select('discount_pct')
      .eq('code', code)
      .eq('active', true)
      .maybeSingle();
    if (data) setPcValid({ pct: data.discount_pct });
    else setPcValid({ error: 'Invalid or expired code' });
  }

  async function onSignup() {
    setError('');
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (!/^\+?\d{10,15}$/.test(phone.replace(/\s+/g, ''))) { setError('Enter a valid phone number.'); return; }

    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          full_name: fullName.trim(),
          phone: phone.replace(/\s+/g, ''),
          promocode: promocode.trim().toUpperCase() || null,
        },
      },
    });
    setLoading(false);
    if (error) setError(error.message);
    // On success: a profile row is auto-created by the DB trigger, and the auth
    // state listener will route the user into the app.
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, padding: spacing.xl }}>
          <View style={{ marginBottom: spacing.xl }}>
            <Text style={{ fontSize: 28, fontWeight: '800', color: colors.text }}>Create account</Text>
            <Text style={{ color: colors.textMuted, marginTop: 4 }}>Save your details, get faster bookings.</Text>
          </View>

          <Label>Full name</Label>
          <TextInput value={fullName} onChangeText={setFullName} placeholder="Your name" placeholderTextColor={colors.textMuted} style={inputStyle} />

          <Label>Phone</Label>
          <TextInput value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="+91 9XXXXXXXXX" placeholderTextColor={colors.textMuted} style={inputStyle} />

          <Label>Email</Label>
          <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="you@example.com" placeholderTextColor={colors.textMuted} style={inputStyle} />

          <Label>Password</Label>
          <TextInput value={password} onChangeText={setPassword} secureTextEntry placeholder="At least 6 characters" placeholderTextColor={colors.textMuted} style={inputStyle} />

          <Label>Promocode (optional)</Label>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <TextInput
              value={promocode}
              onChangeText={(t) => { setPromocode(t.toUpperCase()); setPcValid(null); }}
              autoCapitalize="characters"
              placeholder="e.g. CSC20"
              placeholderTextColor={colors.textMuted}
              style={[inputStyle, { flex: 1 }]}
            />
            <Pressable
              onPress={checkPromocode}
              style={({ pressed }) => ({
                paddingHorizontal: spacing.lg, justifyContent: 'center',
                borderRadius: radius.md, borderWidth: 2, borderColor: colors.primary,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ color: colors.primary, fontWeight: '700' }}>Check</Text>
            </Pressable>
          </View>
          {pcValid && 'pct' in pcValid && (
            <Text style={{ color: colors.success, marginTop: spacing.xs, fontWeight: '600' }}>
              ✓ {pcValid.pct}% off on all your rides
            </Text>
          )}
          {pcValid && 'error' in pcValid && (
            <Text style={{ color: colors.error, marginTop: spacing.xs }}>{pcValid.error}</Text>
          )}

          {error ? <Text style={{ color: colors.error, marginTop: spacing.lg }}>{error}</Text> : null}

          <Pressable
            onPress={onSignup}
            disabled={loading || !fullName || !email || !password || !phone}
            style={({ pressed }) => ({
              backgroundColor: loading || !fullName || !email || !password || !phone ? colors.primaryLight : colors.primary,
              padding: spacing.lg, borderRadius: radius.lg, alignItems: 'center',
              opacity: pressed ? 0.85 : 1, marginTop: spacing.xl,
            })}
          >
            {loading ? <ActivityIndicator color="white" /> : <Text style={{ color: 'white', fontWeight: '700', fontSize: 16 }}>Create Account</Text>}
          </Pressable>

          <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: spacing.xl }}>
            <Text style={{ color: colors.textMuted }}>Already have an account? </Text>
            <Link href="/(auth)/login" style={{ color: colors.primary, fontWeight: '700' }}>Sign in</Link>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <Text style={{ fontSize: 12, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: spacing.xs, marginTop: spacing.md }}>{children}</Text>;
}

const inputStyle = {
  borderWidth: 2, borderColor: colors.border, borderRadius: radius.md,
  padding: spacing.md, fontSize: 16, color: colors.text, backgroundColor: 'white',
};
