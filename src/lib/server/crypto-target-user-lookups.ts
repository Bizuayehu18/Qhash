export type CryptoTargetUserLookup = {
  column: "id" | "username" | "phone";
  value: string;
};

const PROFILE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USERNAME_PATTERN = /^[a-z0-9_]{3,30}$/;
const ETHIOPIAN_PHONE_PATTERN = /^\+251[79]\d{8}$/;

function normalizeEthiopianPhoneReference(value: string): string | null {
  if (!/^[+\d\s()-]+$/.test(value)) return null;

  const digits = value.replace(/\D/g, "");
  let normalized: string;

  if (digits.startsWith("2519") || digits.startsWith("2517")) {
    normalized = `+${digits}`;
  } else if (digits.startsWith("09") || digits.startsWith("07")) {
    normalized = `+251${digits.slice(1)}`;
  } else if (digits.startsWith("9") || digits.startsWith("7")) {
    normalized = `+251${digits}`;
  } else {
    return null;
  }

  return ETHIOPIAN_PHONE_PATTERN.test(normalized) ? normalized : null;
}

export function planCryptoTargetUserLookups(targetUserRef: string): CryptoTargetUserLookup[] {
  const reference = targetUserRef.trim();

  if (PROFILE_ID_PATTERN.test(reference)) {
    return [{ column: "id", value: reference.toLowerCase() }];
  }

  const hasUsernamePrefix = reference.startsWith("@");
  const username = (hasUsernamePrefix ? reference.slice(1) : reference).toLowerCase();
  const lookups: CryptoTargetUserLookup[] = [];

  if (USERNAME_PATTERN.test(username)) {
    lookups.push({ column: "username", value: username });
  }

  if (!hasUsernamePrefix) {
    const phone = normalizeEthiopianPhoneReference(reference);
    if (phone) {
      lookups.push({ column: "phone", value: phone });
    }
  }

  return lookups;
}
