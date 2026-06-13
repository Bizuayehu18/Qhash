import { create } from "zustand";
import { getWalletBalanceFn } from "@/lib/server/wallet.js";
import { getSafeErrorMessage } from "@/lib/errors.js";
import { supabase } from "@/lib/supabase.js";

const WALLET_CACHE_TTL_MS = 60_000;
const BACKGROUND_REFRESH_MS = 120_000;

interface WalletState {
  balance: number | null;
  loading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  _pollTimer: ReturnType<typeof setInterval> | null;
  _pollUserId: string | null;
  _inFlight: Promise<void> | null;

  fetchWallet: (userId: string, options?: { force?: boolean }) => Promise<void>;
  setBalance: (balance: number) => void;
  startPolling: (userId: string) => void;
  stopPolling: () => void;
  reset: () => void;
}

function isFresh(lastFetchedAt: number | null): boolean {
  return typeof lastFetchedAt === "number" && Date.now() - lastFetchedAt < WALLET_CACHE_TTL_MS;
}

function canBackgroundRefresh(): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  if (typeof document !== "undefined" && document.hidden) return false;
  return true;
}

export const useWalletStore = create<WalletState>((set, get) => ({
  balance: null,
  loading: false,
  error: null,
  lastFetchedAt: null,
  _pollTimer: null,
  _pollUserId: null,
  _inFlight: null,

  fetchWallet: async (userId: string, options?: { force?: boolean }) => {
    // Signature kept for existing callers; identity is derived server-side
    // from the session access token rather than this client-passed userId.
    void userId;

    const state = get();

    if (!options?.force && isFresh(state.lastFetchedAt)) {
      return;
    }

    if (state._inFlight) {
      return state._inFlight;
    }

    const request = (async () => {
      set({ loading: get().balance === null, error: null });

      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData?.session?.access_token;

        if (!accessToken) {
          get().stopPolling();
          set({ loading: false, error: "Session expired. Please sign in again." });
          return;
        }

        const { balance } = await getWalletBalanceFn({ data: { accessToken } });
        set({ balance, loading: false, lastFetchedAt: Date.now(), error: null });
      } catch (err) {
        const message = getSafeErrorMessage(err, "WALLET").message;

        if (/session|token|expired/i.test(message)) {
          get().stopPolling();
        }

        console.error("[QHash] Wallet fetch error:", err);
        set({
          loading: false,
          error: message,
        });
      } finally {
        set({ _inFlight: null });
      }
    })();

    set({ _inFlight: request });
    return request;
  },

  setBalance: (balance: number) => {
    set({ balance, lastFetchedAt: Date.now(), error: null });
  },

  startPolling: (userId: string) => {
    const state = get();
    if (state._pollTimer && state._pollUserId === userId) return;

    state.stopPolling();

    if (canBackgroundRefresh()) {
      void get().fetchWallet(userId);
    }

    const timer = setInterval(() => {
      if (canBackgroundRefresh()) {
        void get().fetchWallet(userId);
      }
    }, BACKGROUND_REFRESH_MS);

    set({ _pollTimer: timer, _pollUserId: userId });
  },

  stopPolling: () => {
    const timer = get()._pollTimer;
    if (timer) clearInterval(timer);
    set({ _pollTimer: null, _pollUserId: null });
  },

  reset: () => {
    get().stopPolling();
    set({
      balance: null,
      loading: false,
      error: null,
      lastFetchedAt: null,
      _inFlight: null,
    });
  },
}));
