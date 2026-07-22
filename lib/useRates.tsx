import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import {
  DEFAULT_RATES,
  fetchRates,
  ratesAreStale,
  readCachedRates,
  type RateCard,
} from './rates';

interface RatesCtx {
  rates: RateCard;
  /** True while the very first load is still resolving. */
  loading: boolean;
  /** Set when the last refresh failed — the card in hand is cached or bundled. */
  error: string | null;
  /** Where the numbers on screen came from. */
  source: 'live' | 'cached' | 'bundled';
  updatedAt: number | null;
  refresh: () => Promise<void>;
}

const Ctx = createContext<RatesCtx>({
  rates: DEFAULT_RATES,
  loading: true,
  error: null,
  source: 'bundled',
  updatedAt: null,
  refresh: async () => {},
});

export function RatesProvider({ children }: { children: ReactNode }) {
  const [rates, setRates] = useState<RateCard>(DEFAULT_RATES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<RatesCtx['source']>('bundled');
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const card = await fetchRates();
      setRates(card);
      setSource('live');
      setUpdatedAt(Date.now());
      setError(null);
    } catch (e: any) {
      // Never let a pricing fetch failure block booking — we already hold a card.
      setError(e?.message ?? 'Could not refresh rates');
    }
  }, []);

  // Stale-while-revalidate: paint the cached card immediately, then revalidate.
  useEffect(() => {
    let alive = true;
    (async () => {
      const cached = await readCachedRates();
      if (alive && cached) {
        setRates(cached.card);
        setSource('cached');
        setUpdatedAt(cached.fetchedAt);
      }
      if (alive) setLoading(false);
      if (!cached || ratesAreStale(cached.fetchedAt)) await refresh();
    })();
    return () => { alive = false; };
  }, [refresh]);

  // Management can revise fares mid-session; pick them up on foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && (!updatedAt || ratesAreStale(updatedAt))) refresh();
    });
    return () => sub.remove();
  }, [refresh, updatedAt]);

  return (
    <Ctx.Provider value={{ rates, loading, error, source, updatedAt, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export const useRates = () => useContext(Ctx);
