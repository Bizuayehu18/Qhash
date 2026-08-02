/**
 * Recognizes the exact timestamp-string boundary historically used by QHash
 * transport readers. This intentionally follows JavaScript Date parsing; it
 * is not an ISO 8601 or RFC 3339 validator and performs no normalization.
 */
export function isParseableTimestampString(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(new Date(value).getTime());
}
