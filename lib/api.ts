import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

// Base URL for the CSCTravels Next.js backend (Mongo + JWT).
// Override per-environment in app.json -> extra.API_URL.
const API_URL = (Constants.expoConfig?.extra?.API_URL as string | undefined)
  ?? 'http://localhost:3000';

const TOKEN_KEY = 'csctravel.token';

let _tokenMem: string | null = null;

export async function getToken(): Promise<string | null> {
  if (_tokenMem) return _tokenMem;
  const t = await AsyncStorage.getItem(TOKEN_KEY);
  _tokenMem = t;
  return t;
}

export async function setToken(token: string | null) {
  _tokenMem = token;
  if (token) await AsyncStorage.setItem(TOKEN_KEY, token);
  else await AsyncStorage.removeItem(TOKEN_KEY);
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  auth?: boolean;
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { body, auth = true, headers, ...rest } = opts;
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(headers as Record<string, string> | undefined),
  };
  if (auth) {
    const token = await getToken();
    if (token) h.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API_URL}${path}`, {
    ...rest,
    headers: h,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { message: text }; }
  if (!res.ok || parsed?.success === false) {
    const msg = parsed?.message || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return parsed as T;
}

export { API_URL };
