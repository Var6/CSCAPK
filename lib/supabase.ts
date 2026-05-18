import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';

const url = Constants.expoConfig?.extra?.SUPABASE_URL as string | undefined;
const anon = Constants.expoConfig?.extra?.SUPABASE_ANON_KEY as string | undefined;

if (!url || !anon) {
  console.warn('Supabase env vars missing. Set SUPABASE_URL and SUPABASE_ANON_KEY in app.json -> extra.');
}

export const supabase = createClient(url ?? '', anon ?? '', {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
