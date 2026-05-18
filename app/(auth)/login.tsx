import { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { Link } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import { colors, spacing, radius } from '../../lib/theme';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onLogin() {
    setError('');
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (error) setError(error.message);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, padding: spacing.xl, justifyContent: 'center' }}>
          <View style={{ marginBottom: spacing.xxl }}>
            <View style={{ width: 64, height: 64, borderRadius: radius.xl, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg }}>
              <Text style={{ color: 'white', fontSize: 28, fontWeight: '900' }}>C</Text>
            </View>
            <Text style={{ fontSize: 28, fontWeight: '800', color: colors.text }}>Welcome back</Text>
            <Text style={{ color: colors.textMuted, marginTop: 4 }}>Sign in to book your next ride.</Text>
          </View>

          <Label>Email</Label>
          <TextInput
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="you@example.com"
            placeholderTextColor={colors.textMuted}
            style={inputStyle}
          />

          <Label>Password</Label>
          <TextInput
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            placeholder="••••••••"
            placeholderTextColor={colors.textMuted}
            style={inputStyle}
          />

          {error ? (
            <Text style={{ color: colors.error, marginBottom: spacing.md }}>{error}</Text>
          ) : null}

          <Pressable
            onPress={onLogin}
            disabled={loading || !email || !password}
            style={({ pressed }) => ({
              backgroundColor: loading || !email || !password ? colors.primaryLight : colors.primary,
              padding: spacing.lg,
              borderRadius: radius.lg,
              alignItems: 'center',
              opacity: pressed ? 0.85 : 1,
              marginTop: spacing.md,
            })}
          >
            {loading ? <ActivityIndicator color="white" /> : (
              <Text style={{ color: 'white', fontWeight: '700', fontSize: 16 }}>Sign In</Text>
            )}
          </Pressable>

          <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: spacing.xl }}>
            <Text style={{ color: colors.textMuted }}>New here? </Text>
            <Link href="/(auth)/signup" style={{ color: colors.primary, fontWeight: '700' }}>Create account</Link>
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
