import { create } from "zustand";
import { getWalletBalanceFn } from "@/lib/server/wallet.js";
import { getSafeErrorMessage } from "@/lib/errors.js";
import { supabase } from "@/lib/supabase.js";
import { withTimeout } from "@/lib/async.js";
import { createWalletRequestGuard } from "./wallet-request-guard.js";

const WALLET_CACHE_TTL_MS = 60_000;
const BACKGROUND_REFRESH_MS = 120_000;
const WALLET_SESSION_TIMEOUT_MS = 8_000;
const WALLET_BALANCE_TIMEOUT_MS = 10_000;

interface WalletState {
  activeUserId: string | null;
  balance: number | null;
  loading: boolean;
  error: string | null;
  lastFetchedAt: number | null;
  _pollTimer: ReturnType<typeof setInterval> | null;
  _pollUserId: string | null;
  _inFlight: Promise<void> | null;
  _inFlightUserId: string | null;

  fetchWallet: (userId: string, options?: { force?: boolean }) => Promise<void>;
  setBalanceForUser: (userId: string, balance: number) => void;
  startPolling: (userId: string) => void;
  stopPolling: () => void;
  reset: () => void;
}

function isFresh(lastFetchedAt: number | null): boolean {
  return typeof lastFetchedAt === "number"
    && Date.now() - lastFetchedAt < WALLET_CACHE_TTL_MS;
}

function canBackgroundRefresh(): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
  if (typeof document !== "undefined" && document.hidden) return false;
  return true;
}

const walletRequestGuard = createWalletRequestGuard();

export const useWalletStore = create<WalletState>((set, get) => ({
  activeUserId: null,
  balance: null,
  loading: false,
  error: null,
  lastFetchedAt: null,
  _pollTimer: null,
  _pollUserId: null,
  _inFlight: null,
  _inFlightUserId: null,

  fetchWallet: async (userId: string, options?: { force?: boolean }) => {
    const state = get();
    if (state.activeUserId !== userId) return;

    if (!options?.force && isFresh(state.lastFetchedAt)) return;
    if (state._inFlight && state._inFlightUserId === userId) {
      return state._inFlight;
    }

    const ticket = walletRequestGuard.begin(userId);
    const isCurrentRequest = () => ticket.isCurrent(get().activeUserId);
    const request = Promise.resolve().then(async () => {
      if (!isCurrentRequest()) return;

      try {
        const { data: sessionData } = await withTimeout(
          supabase.auth.getSession(),
          WALLET_SESSION_TIMEOUT_MS,
          "Wallet session request timed out.",
        );
        if (!isCurrentRequest()) return;

        const session = sessionData?.session;
        const accessToken = session?.access_token;
        if (!accessToken || session.user.id !== userId) {
          get().stopPolling();
          if (isCurrentRequest()) {
            set({
              balance: null,
              loading: false,
              error: "Session expired. Please sign in again.",
              lastFetchedAt: null,
            });
          }
          return;
        }

        const { balance } = await withTimeout(
          getWalletBalanceFn({ data: { accessToken } }),
          WALLET_BALANCE_TIMEOUT_MS,
          "Wallet balance request timed out.",
        );
        if (!isCurrentRequest()) return;

        set({ balance, loading: false, lastFetchedAt: Date.now(), error: null });
      } catch (err) {
        if (!isCurrentRequest()) return;

        const message = getSafeErrorMessage(err, "WALLET").message;
        if (/session|token|expired/i.test(message)) get().stopPolling();

        console.error("[QHash] Wallet fetch error:", err);
        set({ loading: false, error: message });
      } finally {
        if (isCurrentRequest()) {
          set({ _inFlight: null, _inFlightUserId: null, loading: false });
        }
      }
    });

    set({
      _inFlight: request,
      _inFlightUserId: userId,
      loading: state.balance === null,
      error: null,
    });
    return request;
  },

  setBalanceForUser: (userId: string, balance: number) => {
    if (get().activeUserId !== userId) return;
    set({ balance, lastFetchedAt: Date.now(), error: null });
  },

  startPolling: (userId: string) => {
    const state = get();
    if (state.activeUserId !== userId) {
      state.stopPolling();
      walletRequestGuard.activateUser(userId);
      set({
        activeUserId: userId,
        balance: null,
        loading: false,
        error: null,
        lastFetchedAt: null,
        _inFlight: null,
        _inFlightUserId: null,
      });
    }

    const current = get();
    if (current._pollTimer && current._pollUserId === userId) return;
    current.stopPolling();

    if (canBackgroundRefresh()) void get().fetchWallet(userId);

    const timer = setInterval(() => {
      if (canBackgroundRefresh()) void get().fetchWallet(userId);
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
    walletRequestGuard.invalidate();
    set({
      activeUserId: null,
      balance: null,
      loading: false,
      error: null,
      lastFetchedAt: null,
      _inFlight: null,
      _inFlightUserId: null,
    });
  },
}));
