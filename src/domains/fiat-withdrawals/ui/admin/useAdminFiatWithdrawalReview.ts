import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { getSafeErrorMessage } from "@/lib/errors.js";
import {
  adminFiatWithdrawalGlobalReviewFlights,
  createAdminFiatWithdrawalAuthIdentity,
  createAdminFiatWithdrawalScopedValue,
  createLatestAdminFiatWithdrawalReviewGuard,
  isSameAdminFiatWithdrawalAuthIdentity,
  readAdminFiatWithdrawalScopedValue,
  type AdminFiatWithdrawalAuthIdentity,
  type AdminFiatWithdrawalScopedValue,
} from "../../application/admin-fiat-withdrawal-operations-auth-lifecycle.js";
import {
  reviewAdminFiatWithdrawal,
  type AdminFiatWithdrawalReviewInput,
} from "../../application/admin-fiat-withdrawal-operations-browser-service.js";

type AdminFiatWithdrawalReviewFlight = Readonly<{
  fingerprint: string;
  identity: AdminFiatWithdrawalAuthIdentity;
  promise: Promise<boolean>;
  token: symbol;
  withdrawalId: string;
}>;

function createReviewFingerprint(
  input: AdminFiatWithdrawalReviewInput,
): string {
  return JSON.stringify([
    input.withdrawalId,
    input.action,
    input.adminNote,
  ]);
}

export function useAdminFiatWithdrawalReview(
  userId: string | null | undefined,
  accessToken: string | null | undefined,
  onAccepted: () => void,
) {
  const identity = useMemo(
    () => createAdminFiatWithdrawalAuthIdentity(userId, accessToken),
    [accessToken, userId],
  );
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const onAcceptedRef = useRef(onAccepted);
  onAcceptedRef.current = onAccepted;

  const mountedRef = useRef(false);
  const requestGuardRef = useRef(createLatestAdminFiatWithdrawalReviewGuard());
  const activeReviewRef = useRef<AdminFiatWithdrawalReviewFlight | null>(null);
  const [busyState, setBusyState] = useState<
    AdminFiatWithdrawalScopedValue<string> | null
  >(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestGuardRef.current.invalidate();
      activeReviewRef.current = null;
    };
  }, []);

  useEffect(() => {
    requestGuardRef.current.invalidate();
    activeReviewRef.current = null;
    setBusyState(null);

    return () => {
      requestGuardRef.current.invalidate();
      activeReviewRef.current = null;
    };
  }, [identity]);

  const reviewWithdrawal = useCallback((
    input: AdminFiatWithdrawalReviewInput,
  ): Promise<boolean> => {
    const expectedIdentity = identityRef.current;
    if (!expectedIdentity) return Promise.resolve(false);

    const fingerprint = createReviewFingerprint(input);
    const activeReview = activeReviewRef.current;
    if (
      activeReview
      && activeReview.fingerprint === fingerprint
      && isSameAdminFiatWithdrawalAuthIdentity(
        activeReview.identity,
        expectedIdentity,
      )
    ) {
      return activeReview.promise;
    }

    if (activeReview) {
      if (!isSameAdminFiatWithdrawalAuthIdentity(
        activeReview.identity,
        expectedIdentity,
      )) {
        activeReviewRef.current = null;
      } else {
        return Promise.resolve(false);
      }
    }

    const request = requestGuardRef.current.begin(expectedIdentity);
    const flightToken = Symbol("admin-fiat-withdrawal-review-flight");
    setBusyState(createAdminFiatWithdrawalScopedValue(
      expectedIdentity,
      input.withdrawalId,
    ));

    const durableReview = adminFiatWithdrawalGlobalReviewFlights.run(
      {
        fingerprint,
        identity: expectedIdentity,
        withdrawalId: input.withdrawalId,
      },
      () => reviewAdminFiatWithdrawal(expectedIdentity.accessToken, input),
    );

    if (!durableReview) {
      setBusyState(null);
      return Promise.resolve(false);
    }

    const promise = (async () => {
      try {
        await durableReview;

        if (!mountedRef.current || !request.isCurrent(identityRef.current)) {
          return false;
        }

        toast.success(
          input.action === "approve"
            ? "Withdrawal approved."
            : "Withdrawal rejected and refunded.",
        );
        onAcceptedRef.current();
        return true;
      } catch (error) {
        if (!mountedRef.current || !request.isCurrent(identityRef.current)) {
          return false;
        }

        toast.error(getSafeErrorMessage(error, "ADMIN").message);
        return false;
      } finally {
        if (activeReviewRef.current?.token === flightToken) {
          activeReviewRef.current = null;
          if (request.isCurrent(identityRef.current)) {
            setBusyState(null);
          }
        }
      }
    })();

    activeReviewRef.current = {
      fingerprint,
      identity: expectedIdentity,
      promise,
      token: flightToken,
      withdrawalId: input.withdrawalId,
    };
    return promise;
  }, []);

  const busyWithdrawalId = readAdminFiatWithdrawalScopedValue(
    busyState,
    identity,
  );
  return {
    actionLoading: busyWithdrawalId !== null,
    busyWithdrawalId,
    reviewWithdrawal,
  };
}
