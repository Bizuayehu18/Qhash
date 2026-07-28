import {
  sanitizeDisabledNowpaymentsDepositOverview,
  type NowpaymentsDepositOverview,
} from "./nowpayments-deposit-ui.js";

export type CopyFeedback = {
  copied: boolean;
  announcement: string;
};

export const IDLE_COPY_FEEDBACK: CopyFeedback = {
  copied: false,
  announcement: "",
};

export type NowpaymentsDepositUiState = {
  overview: NowpaymentsDepositOverview | null;
  loading: boolean;
  error: boolean;
  copyFeedback: CopyFeedback;
  qrDataUrl: string | null;
};

export const INITIAL_NOWPAYMENTS_DEPOSIT_UI_STATE: NowpaymentsDepositUiState = {
  overview: null,
  loading: true,
  error: false,
  copyFeedback: IDLE_COPY_FEEDBACK,
  qrDataUrl: null,
};

export type NowpaymentsDepositUiAction =
  | { type: "auth_reset" }
  | { type: "overview_loading" }
  | { type: "overview_success"; overview: NowpaymentsDepositOverview }
  | { type: "overview_failure" }
  | { type: "confirmed_disabled" }
  | { type: "set_loading"; loading: boolean }
  | { type: "set_error"; error: boolean }
  | { type: "clear_address_presentation" }
  | { type: "set_copy_feedback"; copyFeedback: CopyFeedback }
  | { type: "set_qr_data_url"; qrDataUrl: string | null };

export function nowpaymentsDepositUiReducer(
  state: NowpaymentsDepositUiState,
  action: NowpaymentsDepositUiAction,
): NowpaymentsDepositUiState {
  switch (action.type) {
    case "auth_reset":
      return { ...INITIAL_NOWPAYMENTS_DEPOSIT_UI_STATE };
    case "overview_loading":
      return { ...state, loading: true, error: false };
    case "overview_success":
      return {
        overview: action.overview,
        loading: false,
        error: false,
        copyFeedback: IDLE_COPY_FEEDBACK,
        qrDataUrl: null,
      };
    case "overview_failure":
      return {
        overview: null,
        loading: false,
        error: true,
        copyFeedback: IDLE_COPY_FEEDBACK,
        qrDataUrl: null,
      };
    case "confirmed_disabled":
      return {
        overview: state.overview
          ? sanitizeDisabledNowpaymentsDepositOverview(state.overview)
          : null,
        loading: false,
        error: false,
        copyFeedback: IDLE_COPY_FEEDBACK,
        qrDataUrl: null,
      };
    case "set_loading":
      return { ...state, loading: action.loading };
    case "set_error":
      return { ...state, error: action.error };
    case "clear_address_presentation":
      return {
        ...state,
        copyFeedback: IDLE_COPY_FEEDBACK,
        qrDataUrl: null,
      };
    case "set_copy_feedback":
      return { ...state, copyFeedback: action.copyFeedback };
    case "set_qr_data_url":
      return { ...state, qrDataUrl: action.qrDataUrl };
  }
}

export function nowpaymentsDepositUiVisibility(state: NowpaymentsDepositUiState) {
  const featureEnabled = state.overview?.feature_enabled === true;
  const activeAddressVisible = featureEnabled && state.overview?.active_session !== null;
  const sessionState = state.overview?.session_state;
  return {
    address: activeAddressVisible,
    qr: activeAddressVisible,
    qrData: activeAddressVisible && state.qrDataUrl !== null,
    copy: activeAddressVisible,
    generate: featureEnabled
      && !activeAddressVisible
      && sessionState !== "provisioning"
      && sessionState !== "manual_review",
    safety: featureEnabled,
    balances: state.overview !== null,
    history: state.overview !== null,
    retry: state.error && state.overview === null,
  };
}

export function copyButtonAccessibleName({
  addressSendable,
  copied,
}: {
  addressSendable: boolean;
  copied: boolean;
}): string {
  if (!addressSendable) return "Copy disabled for expired address.";
  return copied
    ? "USDT BEP20 deposit address copied."
    : "Copy USDT BEP20 deposit address.";
}

export async function copyUsdtDepositAddress(
  address: string,
  writeText: (value: string) => Promise<void>,
): Promise<CopyFeedback> {
  try {
    await writeText(address);
    return {
      copied: true,
      announcement: "USDT BEP20 deposit address copied to clipboard.",
    };
  } catch {
    return {
      copied: false,
      announcement: "Unable to copy the USDT BEP20 deposit address. Please copy it manually.",
    };
  }
}
