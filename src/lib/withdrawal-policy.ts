export const CROSS_RAIL_WITHDRAWAL_POLICY_MESSAGE =
  "One withdrawal every 24 hours across all withdrawal methods";

const ISO_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|([+-])(\d{2}):(\d{2}))$/;
const NEXT_ALLOWED_DETAIL_PATTERN = /^next_allowed_at=(.+)$/;

export function normalizeWithdrawalNextAllowedAt(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = ISO_TIMESTAMP_PATTERN.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[8] === undefined ? 0 : Number(match[8]);
  const offsetMinute = match[9] === undefined ? 0 : Number(match[9]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];

  if (
    year === 0
    || month < 1
    || month > 12
    || day < 1
    || day > daysInMonth[month - 1]
    || hour > 23
    || minute > 59
    || second > 59
    || offsetHour > 14
    || offsetMinute > 59
    || (offsetHour === 14 && offsetMinute !== 0)
  ) {
    return null;
  }

  return value;
}

export function parseWithdrawalCooldownDetail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = NEXT_ALLOWED_DETAIL_PATTERN.exec(value);
  return match ? normalizeWithdrawalNextAllowedAt(match[1]) : null;
}

export function formatWithdrawalCooldownMessage(
  nextAllowedAt: unknown,
): string {
  const normalized = normalizeWithdrawalNextAllowedAt(nextAllowedAt);
  return normalized
    ? `${CROSS_RAIL_WITHDRAWAL_POLICY_MESSAGE}. Next eligible: ${normalized}.`
    : `${CROSS_RAIL_WITHDRAWAL_POLICY_MESSAGE}.`;
}
