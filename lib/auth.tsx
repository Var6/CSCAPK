import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, getToken, setToken, BILLING_URL } from './api';

/**
 * Customer auth — against CSCBilling.
 *
 * This used to point at www.csctravels.com. It had to move: a booking is only
 * useful to a driver if it lands in the same database the dispatch engine reads,
 * and that is CSCBilling's Mongo. Auth follows the bookings, because the JWT
 * that authorises a booking has to be one CSCBilling can verify.
 *
 * CSCBilling replies with { success, token, customer }; the app has always
 * modelled this as { token, user }, so the mapping happens here rather than
 * rippling a rename through every screen.
 *
 * MIGRATION NOTE: if www.csctravels.com was backed by a different customer
 * collection, existing riders will not find their account here and will need to
 * register once. Same phone number reclaims their history — the register route
 * adopts an existing customer row by phone rather than creating a duplicate.
 */

export interface User {
  _id: string;
  name: string;
  phone: string;
  email?: string | null;
  address?: string | null;
  totalRides?: number;
  role: 'customer';
}

interface AuthCtx {
  user: User | null;
  loading: boolean;
  signIn: (identifier: string, password: string) => Promise<void>;
  signUp: (input: { name: string; phone: string; email?: string; password: string; address?: string }) => Promise<void>;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({
  user: null,
  loading: true,
  signIn: async () => {},
  signUp: async () => {},
  refresh: async () => {},
  signOut: async () => {},
});

/** CSCBilling's customer payload. */
interface CustomerPayload {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  address?: string | null;
  totalRides?: number;
}

interface AuthResponse { token: string; customer: CustomerPayload }
interface MeResponse { customer: CustomerPayload }

const toUser = (c: CustomerPayload): User => ({
  _id: c.id,
  name: c.name,
  phone: c.phone,
  email: c.email ?? null,
  address: c.address ?? null,
  totalRides: c.totalRides ?? 0,
  role: 'customer',
});

/** Everything auth-related lives on the billing backend. */
const opts = { baseUrl: BILLING_URL } as const;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchMe() {
    try {
      const data = await api<MeResponse>('/api/customer/auth/me', opts);
      setUser(toUser(data.customer));
    } catch {
      await setToken(null);
      setUser(null);
    }
  }

  useEffect(() => {
    (async () => {
      const t = await getToken();
      if (t) await fetchMe();
      setLoading(false);
    })();
  }, []);

  const signIn: AuthCtx['signIn'] = async (identifier, password) => {
    const data = await api<AuthResponse>('/api/customer/auth/login', {
      ...opts,
      method: 'POST',
      auth: false,
      body: { identifier, password },
    });
    await setToken(data.token);
    setUser(toUser(data.customer));
  };

  const signUp: AuthCtx['signUp'] = async (input) => {
    const data = await api<AuthResponse>('/api/customer/auth/register', {
      ...opts,
      method: 'POST',
      auth: false,
      body: input,
    });
    await setToken(data.token);
    setUser(toUser(data.customer));
  };

  const signOut = async () => {
    try { await api('/api/customer/auth/logout', { ...opts, method: 'POST' }); } catch {}
    await setToken(null);
    setUser(null);
  };

  return (
    <Ctx.Provider value={{ user, loading, signIn, signUp, refresh: fetchMe, signOut }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
