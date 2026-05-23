import { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Link } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../lib/auth';
import { colors, spacing, radius } from '../../lib/theme';

export default function Signup() {
  const { signUp } = useAuth();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [address, setAddress] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSignup() {
    setError('');
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    const trimmedPhone = phone.replace(/\s+/g, '').replace(/^\+91/, '');
    if (!/^[6-9]\d{9}$/.test(trimmedPhone)) { setError('Enter a valid 10-digit Indian mobile.'); return; }

    setLoading(true);
    try {
      await signUp({
        name: name.trim(),
        phone: trimmedPhone,
        email: email.trim() || undefined,
        password,
        address: address.trim() || undefined,
      });
    } catch (e: any) {
      setError(e.message ?? 'Sign up failed');
    } finally {
      setLoading(false);
    }
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
          <TextInput value={name} onChangeText={setName} placeholder="Your name" placeholderTextColor={colors.textMuted} style={inputStyle} />

          <Label>Phone</Label>
          <TextInput value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="9XXXXXXXXX" placeholderTextColor={colors.textMuted} style={inputStyle} />

          <Label>Email (optional)</Label>
          <TextInput value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" placeholder="you@example.com" placeholderTextColor={colors.textMuted} style={inputStyle} />

          <Label>Password</Label>
          <TextInput value={password} onChangeText={setPassword} secureTextEntry placeholder="At least 6 characters" placeholderTextColor={colors.textMuted} style={inputStyle} />

          <Label>Address (optional)</Label>
          <TextInput value={address} onChangeText={setAddress} placeholder="Your address" placeholderTextColor={colors.textMuted} style={inputStyle} />

          {error ? <Text style={{ color: colors.error, marginTop: spacing.lg }}>{error}</Text> : null}

          <Pressable
            onPress={onSignup}
            disabled={loading || !name || !password || !phone}
            style={({ pressed }) => ({
              backgroundColor: loading || !name || !password || !phone ? colors.primaryLight : colors.primary,
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
