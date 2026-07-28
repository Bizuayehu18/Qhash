import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import QRCode from "qrcode";
import { toast } from "sonner";
import {
  isDepositAddressSendable,
  type NowpaymentsDepositOverview,
} from "./nowpayments-deposit-ui.js";
import {
  copyUsdtDepositAddress,
  IDLE_COPY_FEEDBACK,
  type NowpaymentsDepositUiAction,
} from "./usdt-bep20-deposit-state.js";

const COPY_FEEDBACK_TIMEOUT_MS = 2_000;

type AddressPresentationOptions = {
  activeSession: NowpaymentsDepositOverview["active_session"];
  dispatchUi: (action: NowpaymentsDepositUiAction) => void;
  featureEnabled: boolean;
  mountedRef: RefObject<boolean>;
};

export function useUsdtBep20AddressPresentation({
  activeSession,
  dispatchUi,
  featureEnabled,
  mountedRef,
}: AddressPresentationOptions) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addressSendable = featureEnabled && activeSession
    ? isDepositAddressSendable(activeSession, nowMs)
    : false;

  const clearAddressPresentation = useCallback(() => {
    if (copyResetTimerRef.current) {
      clearTimeout(copyResetTimerRef.current);
      copyResetTimerRef.current = null;
    }
    dispatchUi({ type: "clear_address_presentation" });
  }, [dispatchUi]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => () => {
    if (copyResetTimerRef.current) clearTimeout(copyResetTimerRef.current);
  }, []);

  useEffect(() => {
    let cancelled = false;
    dispatchUi({ type: "set_qr_data_url", qrDataUrl: null });
    if (!featureEnabled || !activeSession || !addressSendable) return;
    void QRCode.toDataURL(activeSession.pay_address, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 220,
      color: { dark: "#050505", light: "#ffffff" },
    }).then((dataUrl) => {
      if (!cancelled) dispatchUi({ type: "set_qr_data_url", qrDataUrl: dataUrl });
    }).catch(() => {
      if (!cancelled) dispatchUi({ type: "set_qr_data_url", qrDataUrl: null });
    });
    return () => {
      cancelled = true;
    };
  }, [activeSession, addressSendable, dispatchUi, featureEnabled]);

  const handleCopy = useCallback(async () => {
    if (!featureEnabled || !activeSession || !addressSendable) return;
    if (copyResetTimerRef.current) {
      clearTimeout(copyResetTimerRef.current);
      copyResetTimerRef.current = null;
    }
    const feedback = await copyUsdtDepositAddress(
      activeSession.pay_address,
      (value) => navigator.clipboard.writeText(value),
    );
    if (!mountedRef.current) return;
    dispatchUi({ type: "set_copy_feedback", copyFeedback: feedback });
    if (feedback.copied) {
      copyResetTimerRef.current = setTimeout(() => {
        if (mountedRef.current) {
          dispatchUi({
            type: "set_copy_feedback",
            copyFeedback: IDLE_COPY_FEEDBACK,
          });
        }
        copyResetTimerRef.current = null;
      }, COPY_FEEDBACK_TIMEOUT_MS);
    } else {
      toast.error("Unable to copy. Please copy the address manually.");
    }
  }, [
    activeSession,
    addressSendable,
    dispatchUi,
    featureEnabled,
    mountedRef,
  ]);

  return {
    addressSendable,
    clearAddressPresentation,
    handleCopy,
    nowMs,
  };
}
