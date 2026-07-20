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
  address_activated_at: string | null;
  provisioning_started_at: string;
  created_at: string;
};

export type NowpaymentsSessionLookup =
  | { disposition: "none" }
  | ({ disposition: "activated" | "pending" | "existing" } & NowpaymentsDepositSession);

export type NowpaymentsSessionClaim =
  ({ disposition: "claimed" | "activated" | "pending" | "existing" } & NowpaymentsDepositSession);

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

function assertAddressSession(
  session: NowpaymentsDepositSession,
  lifecycle: "activated" | "pending",
  now: Date,
): NowpaymentsDepositSession {
  if (
    !session.provider_payment_id
    || !session.pay_address
    || !session.provider_created_at
    || !session.provider_valid_until
    || !session.provider_payment_status
  ) {
    throw new NowpaymentsDepositSessionError("session_invalid");
  }

  if (lifecycle === "activated") {
    if (
      !session.address_activated_at
      || session.provider_payment_status !== "finished"
      || new Date(session.address_activated_at).getTime()
        < new Date(session.provider_created_at).getTime()
      || new Date(session.address_activated_at).getTime()
        > new Date(session.provider_valid_until).getTime()
    ) {
      throw new NowpaymentsDepositSessionError("session_invalid");
    }
    return session;
  }

  if (
    session.address_activated_at !== null
    || session.session_status !== "ready"
    || !ACTIVE_STATUSES.has(session.provider_payment_status)
    || new Date(session.provider_valid_until).getTime() <= now.getTime()
  ) {
    throw new NowpaymentsDepositSessionError("session_state_changed");
  }
  return session;
}

function resolveExisting(
  lookup: Exclude<NowpaymentsSessionLookup, { disposition: "none" }>
    | Exclude<NowpaymentsSessionClaim, { disposition: "claimed" }>,
  now: Date,
): NowpaymentsDepositSession {
  const session = lookup as NowpaymentsDepositSession;
  if (lookup.disposition === "activated" || lookup.disposition === "pending") {
    return assertAddressSession(session, lookup.disposition, now);
  }
  if (session.session_status === "provisioning") {
    throw new NowpaymentsDepositSessionError("session_provisioning");
  }
  if (session.session_status === "manual_recovery") {
    throw new NowpaymentsDepositSessionError("session_manual_recovery");
  }
  throw new NowpaymentsDepositSessionError("session_state_changed");
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
    return resolveExisting(current, now());
  }

  let amounts: ReturnType<typeof maximumReferenceAmount>;
  try {
    amounts = maximumReferenceAmount(await provider.getMinimum());
  } catch (error) {
    if (error instanceof NowpaymentsDepositSessionError) throw error;
    throw new NowpaymentsDepositSessionError("minimum_unavailable");
  }

  const claim = await store.claim(
    userId,
    amounts.providerMinimumUsdt,
    amounts.technicalReferenceAmountUsdt,
  );
  if (claim.disposition !== "claimed") {
    return resolveExisting(claim, now());
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
    return assertAddressSession(await store.complete(claim, created), "pending", now());
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
