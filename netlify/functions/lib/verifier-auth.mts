import { timingSafeEqual } from "node:crypto";

type LogFn = (step: string, data: Record<string, unknown>) => void;

export type VerifierAuthResult = { ok: true } | { ok: false; response: Response };

function verifyApiKey(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Validates the verifier API key on an incoming request.
 *
 * Reads the expected key from the TELEBIRR_VERIFIER_API_KEY environment
 * variable and the provided key from the X-Verifier-Api-Key header, then
 * compares them in constant time. Returns a 401 response when the server key
 * is missing, the provided key is missing, or the keys do not match.
 *
 * The auth-failure log records only booleans (hasServerKey / hasProvidedKey)
 * and never the key values. The caller's logError is used so the per-function
 * `fn` field in the log line is preserved.
 */
export function verifyVerifierRequest(req: Request, logError: LogFn): VerifierAuthResult {
  const apiKey = Netlify.env.get("TELEBIRR_VERIFIER_API_KEY") ?? "";
  const providedKey = req.headers.get("x-verifier-api-key") ?? "";

  if (!apiKey || !providedKey || !verifyApiKey(providedKey, apiKey)) {
    logError("verifier_auth_failed", { hasServerKey: !!apiKey, hasProvidedKey: !!providedKey });
    return {
      ok: false,
      response: Response.json({ error: "unauthorized", message: "Invalid or missing API key." }, { status: 401 }),
    };
  }

  return { ok: true };
}
