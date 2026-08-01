function collectErrorText(error: unknown): string {
  const seen = new Set<unknown>();
  const values: string[] = [];

  const collect = (value: unknown) => {
    if (value === null || value === undefined || seen.has(value)) return;

    if (["string", "number", "boolean"].includes(typeof value)) {
      values.push(String(value));
      return;
    }

    if (typeof value !== "object") return;

    seen.add(value);

    if (value instanceof Error) {
      values.push(value.message, value.name);
    }

    Object.values(value as Record<string, unknown>).forEach(collect);
  };

  collect(error);
  return values.join(" ").toLowerCase();
}

export function getFiatWithdrawalSpecificErrorMessage(error: unknown): string | null {
  const text = collectErrorText(error);

  if (
    text.includes("fund_password_not_set") ||
    text.includes("please create your fund password first")
  ) {
    return "Please create your fund password first from Profile → Security.";
  }

  if (
    text.includes("incorrect_fund_password") ||
    text.includes("incorrect fund password")
  ) {
    return "Incorrect fund password.";
  }

  if (
    text.includes("fund_password_locked") ||
    text.includes("fund password is temporarily locked") ||
    text.includes("too many incorrect attempts")
  ) {
    return "Fund password is temporarily locked. Please try again later.";
  }

  if (
    text.includes("invalid fund password format") ||
    text.includes("fund password must be exactly 4 digits")
  ) {
    return "Enter your 4-digit fund password.";
  }

  return null;
}
