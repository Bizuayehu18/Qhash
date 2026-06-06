import { create } from "zustand";
import { getWalletBalanceFn } from "@/lib/server/wallet.js";
import { getSafeErrorMessage } from "@/lib/errors.js";
import { supabase } from "@/lib/supabase.js";

const POLL_INTERVAL_MS = 30_000;

interface WalletState {
  balance: number | null;
  loading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  _pollTimer: ReturnType<typeof setInterval> | null;
  _pollUserId: string | null;

  fetchWallet: (userId: string) => Promise<void>;
  setBalance: (balance: number) => void;
  startPolling: (userId: string) => void;
  stopPolling: () => void;
  reset: () => void;
}

export const useWalletStore = create<WalletState>((set, get) => ({
  balance: null,
  loading: false,
  error: null,
  lastFetchedAt: null,
  _pollTimer: null,
  _pollUserId: null,

  fetchWallet: async (userId: string) => {
    // Signature kept for polling callers; identity is now derived server-side
    // from the session access token rather than this client-passed userId.
    void userId;
    set({ loading: get().balance === null, error: null });
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) {
        set({ loading: false, error: "Session expired. Please sign in again." });
        return;
      }
      const { balance } = await getWalletBalanceFn({ data: { accessToken } });
      set({ balance, loading: false, lastFetchedAt: Date.now(), error: null });
    } catch (err) {
      console.error("[QHash] Wallet fetch error:", err);
      set({
        loading: false,
        error: getSafeErrorMessage(err, "WALLET").message,
      });
    }
  },

  setBalance: (balance: number) => {
    set({ balance, lastFetchedAt: Date.now() });
  },

  startPolling: (userId: string) => {
    const state = get();
    if (state._pollTimer && state._pollUserId === userId) return;

    state.stopPolling();

    get().fetchWallet(userId);

    const timer = setInterval(() => {
      get().fetchWallet(userId);
    }, POLL_INTERVAL_MS);

    set({ _pollTimer: timer, _pollUserId: userId });
  },

  stopPolling: () => {
    const timer = get()._pollTimer;
    if (timer) clearInterval(timer);
    set({ _pollTimer: null, _pollUserId: null });
  },

  reset: () => {
    get().stopPolling();
    set({ balance: null, loading: false, error: null, lastFetchedAt: null });
  },
}));
