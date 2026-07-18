export type NowpaymentsProviderStatus =
  | "waiting"
  | "partially_paid"
  | "confirming"
  | "confirmed"
  | "sending"
  | "finished"
  | "failed"
  | "refunded"
  | "expired";

export type NowpaymentsSessionStatus =
  | "provisioning"
  | "ready"
  | "manual_recovery"
  | "terminal";

export type NowpaymentsDepositSession = {
  id: string;
  user_id: string;
  qhash_order_id: string;
  session_status: NowpaymentsSessionStatus;
  provider_payment_id: string | null;
  provider_payment_status: NowpaymentsProviderStatus | null;
  pay_address: string | null;
  technical_reference_amount_usdt: string;
  provider_minimum_usdt: string;
  provider_created_at: string | null;
  provider_valid_until: string | null;
  provisioning_started_at: string;
  created_at: string;
};

export type NowpaymentsSessionLookup =
  | { disposition: "none" }
  | ({ disposition: "existing" | "terminal" } & NowpaymentsDepositSession);

export type NowpaymentsSessionClaim =
  ({ disposition: "claimed" | "existing" } & NowpaymentsDepositSession);

export type NowpaymentsSessionStore = {
  getCurrent(userId: string): Promise<NowpaymentsSessionLookup>;
  claim(
    userId: string,
    providerMinimumUsdt: string,
    technicalReferenceAmountUsdt: string,
  ): Promise<NowpaymentsSessionClaim>;
  complete(
    session: NowpaymentsDepositSession,
    result: NowpaymentsCreatedPayment,
  ): Promise<NowpaymentsDepositSession>;
  markManualRecovery(
    session: NowpaymentsDepositSession,
    reason: ManualRecoveryReason,
    evidence?: NowpaymentsCreatedPayment,
  ): Promise<NowpaymentsDepositSession>;
  recordStatus(
    session: NowpaymentsDepositSession,
    providerStatus: NowpaymentsProviderStatus,
  ): Promise<NowpaymentsDepositSession>;
};

export type NowpaymentsCreatedPayment = {
  providerPaymentId: string;
  qhashOrderId: string;
  payAddress: string;
  payCurrency: "usdtbsc";
  providerPaymentStatus: Extract<
    NowpaymentsProviderStatus,
    "waiting" | "partially_paid" | "confirming" | "confirmed" | "sending"
  >;
  providerCreatedAt: string;
  providerValidUntil: string;
};

export type NowpaymentsSessionProvider = {
  getMinimum(): Promise<string>;
  createPayment(input: {
    technicalReferenceAmountUsdt: string;
    qhashOrderId: string;
  }): Promise<NowpaymentsCreatedPayment>;
  getPaymentStatus(providerPaymentId: string): Promise<{
    providerPaymentId: string;
    providerPaymentStatus: NowpaymentsProviderStatus;
  }>;
};

export type ManualRecoveryReason =
  | "create_payment_timeout"
  | "create_payment_network_error"
  | "create_payment_http_error"
  | "create_payment_invalid_response"
  | "create_payment_finalize_failed"
  | "payment_status_invalid_response";

const ACTIVE_STATUSES = new Set<NowpaymentsProviderStatus>([
  "waiting",
  "partially_paid",
  "confirming",
  "confirmed",
  "sending",
]);
const TERMINAL_STATUSES = new Set<NowpaymentsProviderStatus>([
  "finished",
  "failed",
  "refunded",
  "expired",
]);
const CREATE_RECOVERY_REASONS = new Set<ManualRecoveryReason>([
  "create_payment_timeout",
  "create_payment_network_error",
  "create_payment_http_error",
  "create_payment_invalid_response",
]);

export class NowpaymentsDepositSessionError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "NowpaymentsDepositSessionError";
    this.code = code;
  }
}

function normalizePositiveDecimal(value: string): string {
  const match = value.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) throw new NowpaymentsDepositSessionError("minimum_invalid");
  const integer = match[1].replace(/^0+(?=\d)/, "");
  const fraction = (match[2] ?? "").replace(/0+$/, "");
  if (integer.length > 18 || fraction.length > 18) {
    throw new NowpaymentsDepositSessionError("minimum_invalid");
  }
  if (BigInt(integer + fraction.padEnd(18, "0")) <= 0n) {
    throw new NowpaymentsDepositSessionError("minimum_invalid");
  }
  return fraction ? `${integer}.${fraction}` : integer;
}

function compareDecimals(left: string, right: string): number {
  const [leftInteger, leftFraction = ""] = left.split(".");
  const [rightInteger, rightFraction = ""] = right.split(".");
  const scale = Math.max(leftFraction.length, rightFraction.length);
  const leftValue = BigInt(leftInteger + leftFraction.padEnd(scale, "0"));
  const rightValue = BigInt(rightInteger + rightFraction.padEnd(scale, "0"));
  return leftValue === rightValue ? 0 : leftValue > rightValue ? 1 : -1;
}

function maximumReferenceAmount(providerMinimum: string): {
  providerMinimumUsdt: string;
  technicalReferenceAmountUsdt: string;
} {
  const normalized = normalizePositiveDecimal(providerMinimum);
  return {
    providerMinimumUsdt: normalized,
    technicalReferenceAmountUsdt:
      compareDecimals(normalized, "1") > 0 ? normalized : "1",
  };
}

function recoveryReason(error: unknown): ManualRecoveryReason {
  if (error && typeof error === "object" && "recoveryReason" in error) {
    const value = (error as { recoveryReason?: unknown }).recoveryReason;
    if (typeof value === "string" && CREATE_RECOVERY_REASONS.has(value as ManualRecoveryReason)) {
      return value as ManualRecoveryReason;
    }
  }
  return "create_payment_invalid_response";
}

async function bestEffortManualRecovery(
  store: NowpaymentsSessionStore,
  session: NowpaymentsDepositSession,
  reason: ManualRecoveryReason,
  evidence?: NowpaymentsCreatedPayment,
): Promise<void> {
  try {
    await store.markManualRecovery(session, reason, evidence);
  } catch {
    // The durable provisioning claim still blocks another create-payment call.
  }
}

function assertReadySession(session: NowpaymentsDepositSession): NowpaymentsDepositSession {
  if (
    session.session_status !== "ready"
    || !session.provider_payment_id
    || !session.pay_address
    || !session.provider_created_at
    || !session.provider_valid_until
    || !session.provider_payment_status
    || !ACTIVE_STATUSES.has(session.provider_payment_status)
  ) {
    throw new NowpaymentsDepositSessionError("session_invalid");
  }
  return session;
}

async function refreshReadySession(
  session: NowpaymentsDepositSession,
  store: NowpaymentsSessionStore,
  provider: NowpaymentsSessionProvider,
  now: Date,
): Promise<NowpaymentsDepositSession | null> {
  const ready = assertReadySession(session);
  let providerStatus: NowpaymentsProviderStatus;
  try {
    const result = await provider.getPaymentStatus(ready.provider_payment_id as string);
    if (result.providerPaymentId !== ready.provider_payment_id) {
      throw new NowpaymentsDepositSessionError("payment_status_invalid_response");
    }
    providerStatus = result.providerPaymentStatus;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
    if (code === "payment_status_invalid_response") {
      await bestEffortManualRecovery(store, ready, "payment_status_invalid_response");
    }
    throw new NowpaymentsDepositSessionError("payment_status_unavailable");
  }

  if (TERMINAL_STATUSES.has(providerStatus)) {
    try {
      await store.recordStatus(ready, providerStatus);
      return null;
    } catch {
      throw new NowpaymentsDepositSessionError("session_state_changed");
    }
  }
  if (!ACTIVE_STATUSES.has(providerStatus)) {
    await bestEffortManualRecovery(store, ready, "payment_status_invalid_response");
    throw new NowpaymentsDepositSessionError("payment_status_unavailable");
  }

  if (
    providerStatus === "waiting"
    && new Date(ready.provider_valid_until as string).getTime() <= now.getTime()
  ) {
    try {
      await store.recordStatus(ready, "expired");
      return null;
    } catch {
      throw new NowpaymentsDepositSessionError("session_state_changed");
    }
  }

  try {
    return assertReadySession(await store.recordStatus(ready, providerStatus));
  } catch {
    throw new NowpaymentsDepositSessionError("session_state_changed");
  }
}

async function resolveExisting(
  session: NowpaymentsDepositSession,
  store: NowpaymentsSessionStore,
  provider: NowpaymentsSessionProvider,
  now: Date,
): Promise<NowpaymentsDepositSession | null> {
  if (session.session_status === "provisioning") {
    throw new NowpaymentsDepositSessionError("session_provisioning");
  }
  if (session.session_status === "manual_recovery") {
    throw new NowpaymentsDepositSessionError("session_manual_recovery");
  }
  if (session.session_status === "terminal") return null;
  return refreshReadySession(session, store, provider, now);
}

export async function getOrCreateNowpaymentsDepositSession({
  userId,
  store,
  provider,
  now = () => new Date(),
}: {
  userId: string;
  store: NowpaymentsSessionStore;
  provider: NowpaymentsSessionProvider;
  now?: () => Date;
}): Promise<NowpaymentsDepositSession> {
  const current = await store.getCurrent(userId);
  if (current.disposition !== "none") {
    const resolved = await resolveExisting(current, store, provider, now());
    if (resolved) return resolved;
  }

  let amounts: ReturnType<typeof maximumReferenceAmount>;
  try {
    amounts = maximumReferenceAmount(await provider.getMinimum());
  } catch {
    throw new NowpaymentsDepositSessionError("minimum_unavailable");
  }

  const claim = await store.claim(
    userId,
    amounts.providerMinimumUsdt,
    amounts.technicalReferenceAmountUsdt,
  );
  if (claim.disposition === "existing") {
    const resolved = await resolveExisting(claim, store, provider, now());
    if (resolved) return resolved;
    throw new NowpaymentsDepositSessionError("session_state_changed");
  }

  let created: NowpaymentsCreatedPayment;
  try {
    created = await provider.createPayment({
      technicalReferenceAmountUsdt: amounts.technicalReferenceAmountUsdt,
      qhashOrderId: claim.qhash_order_id,
    });
  } catch (error) {
    await bestEffortManualRecovery(store, claim, recoveryReason(error));
    throw new NowpaymentsDepositSessionError("payment_creation_uncertain");
  }

  try {
    return assertReadySession(await store.complete(claim, created));
  } catch {
    await bestEffortManualRecovery(
      store,
      claim,
      "create_payment_finalize_failed",
      created,
    );
    throw new NowpaymentsDepositSessionError("payment_creation_uncertain");
  }
}
