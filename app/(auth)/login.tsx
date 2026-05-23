import { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, Image } from 'react-native';
import { Link } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../lib/auth';
import { colors, spacing, radius } from '../../lib/theme';

export default function Login() {
  const { signIn } = useAuth();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onLogin() {
    setError('');
    setLoading(true);
    try { await signIn(identifier.trim(), password); }
    catch (e: any) { setError(e.message ?? 'Sign in failed'); }
    finally { setLoading(false); }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, padding: spacing.xl, justifyContent: 'center' }}>
          <View style={{ alignItems: 'center', marginBottom: spacing.xxl }}>
            <Image
              source={require('../../assets/logo.png')}
              style={{ width: 160, height: 160, marginBottom: spacing.md }}
              resizeMode="contain"
            />
            <Text style={{ fontSize: 28, fontWeight: '800', color: colors.text, textAlign: 'center' }}>Welcome back</Text>
            <Text style={{ color: colors.textMuted, marginTop: 4, textAlign: 'center' }}>Sign in to book your next ride.</Text>
          </View>

          <Label>Phone or Email</Label>
          <TextInput
            value={identifier}
            onChangeText={setIdentifier}
            autoCapitalize="none"
            keyboardType="email-address"
            placeholder="9XXXXXXXXX or you@example.com"
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
            disabled={loading || !identifier || !password}
            style={({ pressed }) => ({
              backgroundColor: loading || !identifier || !password ? colors.primaryLight : colors.primary,
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
