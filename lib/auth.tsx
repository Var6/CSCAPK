import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, getToken, setToken } from './api';

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

interface AuthResponse { token: string; user: User }
interface MeResponse { user: User }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchMe() {
    try {
      const data = await api<MeResponse>('/api/auth/me');
      setUser(data.user);
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
    const data = await api<AuthResponse>('/api/auth/login', {
      method: 'POST',
      auth: false,
      body: { identifier, password },
    });
    await setToken(data.token);
    setUser(data.user);
  };

  const signUp: AuthCtx['signUp'] = async (input) => {
    const data = await api<AuthResponse>('/api/auth/register', {
      method: 'POST',
      auth: false,
      body: input,
    });
    await setToken(data.token);
    setUser(data.user);
  };

  const signOut = async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch {}
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
