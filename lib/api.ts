import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

// Two backends, deliberately:
//
//   API_URL     www.csctravels.com — customer auth and ride bookings.
//   BILLING_URL app.csctravels.com — the CSCBilling console. Serves the live
//               rate card (/api/rates) and proxies Google Places/Directions
//               (/api/maps/*) so the billed server key never ships in the app.
//
// Both are injected by app.config.js from .env.local.
const API_URL = (Constants.expoConfig?.extra?.API_URL as string | undefined)
  ?? 'https://www.csctravels.com';

const BILLING_URL = (Constants.expoConfig?.extra?.BILLING_URL as string | undefined)
  ?? 'https://app.csctravels.com';

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
  /** Defaults to API_URL. Pass BILLING_URL for rate-card and maps calls. */
  baseUrl?: string;
}

export async function api<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { body, auth = true, headers, baseUrl = API_URL, ...rest } = opts;
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(headers as Record<string, string> | undefined),
  };
  if (auth) {
    const token = await getToken();
    if (token) h.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${baseUrl}${path}`, {
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

export { API_URL, BILLING_URL };
