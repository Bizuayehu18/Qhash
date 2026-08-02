const UUID_V1_TO_V5_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validates the canonical hyphenated syntax used by QHash for UUID versions 1-5.
 *
 * This predicate intentionally does not trim, normalize, coerce, or generate values.
 * Callers remain responsible for any domain-specific normalization.
 */
export function isUuidV1ToV5(value: unknown): value is string {
  return typeof value === "string" && UUID_V1_TO_V5_PATTERN.test(value);
}

/**
 * Validates the canonical hyphenated UUID v4 syntax used for request identifiers.
 *
 * This predicate intentionally does not trim, normalize, coerce, or generate values.
 * Callers remain responsible for any domain-specific normalization.
 */
export function isUuidV4(value: unknown): value is string {
  return typeof value === "string" && UUID_V4_PATTERN.test(value);
}
