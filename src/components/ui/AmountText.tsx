interface AmountTextProps {
  value: number;
  currency?: string;
  showSign?: boolean;
  tone?: "auto" | "positive" | "negative" | "neutral" | "muted";
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizeClasses: Record<NonNullable<AmountTextProps["size"]>, string> = {
  sm: "text-xs",
  md: "text-sm",
  lg: "text-base",
};

function getToneClass(value: number, tone: NonNullable<AmountTextProps["tone"]>) {
  if (tone === "positive") return "text-[#00ff41]";
  if (tone === "negative") return "text-red-400";
  if (tone === "muted") return "text-gray-500";
  if (tone === "neutral") return "text-gray-200";
  if (value > 0) return "text-[#00ff41]";
  if (value < 0) return "text-red-400";
  return "text-gray-300";
}

export function CurrencyUnit({ value = "ETB", className = "" }: { value?: string; className?: string }) {
  return (
    <span className={["ml-px text-[0.5em] font-semibold leading-none tracking-tight text-gray-500", className].join(" ")}>
      {value}
    </span>
  );
}

export function AmountText({
  value,
  currency = "ETB",
  showSign = false,
  tone = "auto",
  size = "sm",
  className = "",
}: AmountTextProps) {
  const formatted = Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const sign = showSign && value !== 0 ? (value > 0 ? "+" : "-") : value < 0 ? "-" : "";

  return (
    <span className={["font-mono font-medium", sizeClasses[size], getToneClass(value, tone), className].join(" ")}>
      {sign}{formatted}
      {currency && <CurrencyUnit value={currency} />}
    </span>
  );
}
