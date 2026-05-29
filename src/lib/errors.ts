type ErrorDomain =
  | "AUTH"
  | "DEPOSIT"
  | "PURCHASE"
  | "REFERRAL"
  | "WITHDRAWAL"
  | "WALLET"
  | "SUPPORT"
  | "ADMIN"
  | "PAYMENT"
  | "SERVER";

let errorCounter = 0;

function generateErrorId(domain: ErrorDomain): string {
  errorCounter = (errorCounter + 1) % 10000;
  const ts = Date.now().toString(36).slice(-4).toUpperCase();
  const seq = String(errorCounter).padStart(3, "0");
  return `ERR-${domain}-${ts}${seq}`;
}

export class AppError extends Error {
  public readonly userMessage: string;
  public readonly errorId: string;
  public readonly domain: ErrorDomain;

  constructor(
    domain: ErrorDomain,
    userMessage: string,
    internalMessage: string,
  ) {
    const errorId = generateErrorId(domain);
    super(internalMessage);
    this.name = "AppError";
    this.userMessage = userMessage;
    this.errorId = errorId;
    this.domain = domain;
  }
}

export function logServerError(
  context: string,
  error: unknown,
  extra?: Record<string, unknown>,
): string {
  const errorId = generateErrorId("SERVER");
  const details: Record<string, unknown> = {
    errorId,
    context,
    timestamp: new Date().toISOString(),
    ...extra,
  };

  if (error instanceof AppError) {
    details.errorId = error.errorId;
    details.domain = error.domain;
    details.internalMessage = error.message;
    details.userMessage = error.userMessage;
  } else if (error instanceof Error) {
    details.message = error.message;
    details.stack = error.stack;
  } else {
    details.raw = error;
  }

  console.error(`[QHash Error] ${context}:`, JSON.stringify(details));
  return error instanceof AppError ? error.errorId : errorId;
}

const SAFE_MESSAGES: Record<ErrorDomain, string> = {
  AUTH: "Authentication failed. Please try again.",
  DEPOSIT: "Unable to process deposit right now. Please try again.",
  PURCHASE: "Failed to process purchase. Please try again.",
  REFERRAL: "Referral reward processing failed.",
  WITHDRAWAL: "Withdrawal request failed. Please try again.",
  WALLET: "Unable to load wallet. Please try again.",
  SUPPORT: "Unable to process your request. Please try again.",
  ADMIN: "Admin operation failed. Please try again.",
  PAYMENT: "Payment method operation failed. Please try again.",
  SERVER: "Temporary server issue. Please try again.",
};

export function getSafeErrorMessage(
  error: unknown,
  fallbackDomain: ErrorDomain = "SERVER",
): { message: string; errorId: string | null } {
  if (error instanceof AppError) {
    return { message: `${error.userMessage} (Ref: ${error.errorId})`, errorId: error.errorId };
  }

  const errorId = logServerError("unhandled-frontend-error", error);
  return {
    message: `${SAFE_MESSAGES[fallbackDomain]} (Ref: ${errorId})`,
    errorId,
  };
}

export function throwSafe(
  domain: ErrorDomain,
  userMessage: string,
  internalMessage: string,
): never {
  const err = new AppError(domain, userMessage, internalMessage);
  logServerError(`${domain.toLowerCase()}-error`, err);
  throw err;
}

export function throwSafeFromDb(
  domain: ErrorDomain,
  userMessage: string,
  dbError: { message?: string; code?: string; details?: string; hint?: unknown },
): never {
  const internal = [
    dbError.message,
    dbError.code && `code=${dbError.code}`,
    dbError.details && `details=${dbError.details}`,
    dbError.hint && `hint=${dbError.hint}`,
  ]
    .filter(Boolean)
    .join(" | ");

  throwSafe(domain, userMessage, internal || "Unknown database error");
}
