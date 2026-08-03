import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { getSafeErrorMessage } from "@/lib/errors.js";
import {
  adminFiatDepositGlobalReviewFlights,
  createAdminFiatDepositAuthIdentity,
  createAdminFiatDepositScopedValue,
  createLatestAdminFiatDepositReviewGuard,
  isSameAdminFiatDepositAuthIdentity,
  readAdminFiatDepositScopedValue,
  type AdminFiatDepositAuthIdentity,
  type AdminFiatDepositScopedValue,
} from "../../application/admin-fiat-deposit-operations-auth-lifecycle.js";
import {
  reviewAdminFiatDeposit,
  type AdminFiatDepositReviewInput,
} from "../../application/admin-fiat-deposit-operations-browser-service.js";

type AdminFiatDepositReviewFlight = Readonly<{
  fingerprint: string;
  identity: AdminFiatDepositAuthIdentity;
  promise: Promise<boolean>;
  token: symbol;
}>;

function createReviewFingerprint(input: AdminFiatDepositReviewInput): string {
  return JSON.stringify([
    input.depositId,
    input.action,
    input.adminNote,
    input.verifiedAmount ?? null,
  ]);
}

export function useAdminFiatDepositReview(
  userId: string | null | undefined,
  accessToken: string | null | undefined,
  onAccepted: () => void,
) {
  const identity = useMemo(
    () => createAdminFiatDepositAuthIdentity(userId, accessToken),
    [accessToken, userId],
  );
  const identityRef = useRef(identity);
  identityRef.current = identity;
  const onAcceptedRef = useRef(onAccepted);
  onAcceptedRef.current = onAccepted;

  const mountedRef = useRef(false);
  const requestGuardRef = useRef(createLatestAdminFiatDepositReviewGuard());
  const activeReviewRef = useRef<AdminFiatDepositReviewFlight | null>(null);
  const [busyState, setBusyState] = useState<
    AdminFiatDepositScopedValue<string> | null
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

  const reviewDeposit = useCallback((
    input: AdminFiatDepositReviewInput,
  ): Promise<boolean> => {
    const expectedIdentity = identityRef.current;
    if (!expectedIdentity) return Promise.resolve(false);

    const fingerprint = createReviewFingerprint(input);
    const activeReview = activeReviewRef.current;
    if (
      activeReview
      && activeReview.fingerprint === fingerprint
      && isSameAdminFiatDepositAuthIdentity(
        activeReview.identity,
        expectedIdentity,
      )
    ) {
      return activeReview.promise;
    }

    if (activeReview) {
      if (!isSameAdminFiatDepositAuthIdentity(
        activeReview.identity,
        expectedIdentity,
      )) {
        activeReviewRef.current = null;
      } else {
        return Promise.resolve(false);
      }
    }

    const request = requestGuardRef.current.begin(expectedIdentity);
    const flightToken = Symbol("admin-fiat-deposit-review-flight");
    setBusyState(createAdminFiatDepositScopedValue(
      expectedIdentity,
      input.depositId,
    ));

    const promise = (async () => {
      try {
        await adminFiatDepositGlobalReviewFlights.run(
          { fingerprint, identity: expectedIdentity },
          () => reviewAdminFiatDeposit(
            expectedIdentity.accessToken,
            input,
          ),
        );

        if (!mountedRef.current || !request.isCurrent(identityRef.current)) {
          return false;
        }

        toast.success(
          `Deposit ${input.action === "approve" ? "approved" : "rejected"}.`,
        );
        onAcceptedRef.current();
        return true;
      } catch (error) {
        if (
          !mountedRef.current
          || !request.isCurrent(identityRef.current)
        ) {
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
    };
    return promise;
  }, []);

  const busyDepositId = readAdminFiatDepositScopedValue(busyState, identity);
  return {
    actionLoading: busyDepositId !== null,
    busyDepositId,
    reviewDeposit,
  };
}
