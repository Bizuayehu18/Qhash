/**
 * Preserves QHash's established loose object boundary: any non-null object
 * except an array. This intentionally accepts class instances, built-in
 * objects, and null-prototype objects; it is not plain-object or schema
 * validation and performs no normalization or cloning.
 */
export function isNonNullNonArrayObject(
  value: unknown,
): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
