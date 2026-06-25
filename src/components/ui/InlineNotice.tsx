import type { ReactNode } from "react";

type InlineNoticeVariant = "info" | "success" | "warning" | "danger" | "neon";

interface InlineNoticeProps {
  children: ReactNode;
  title?: ReactNode;
  icon?: ReactNode;
  variant?: InlineNoticeVariant;
  className?: string;
}

const variants: Record<InlineNoticeVariant, string> = {
  info: "border-blue-400/15 bg-blue-400/[0.05] text-gray-400",
  success: "border-emerald-400/15 bg-emerald-400/[0.05] text-gray-400",
  warning: "border-amber-400/20 bg-amber-400/[0.06] text-amber-200",
  danger: "border-red-400/20 bg-red-400/[0.06] text-red-200",
  neon: "border-[rgba(0,255,65,0.12)] bg-[rgba(0,255,65,0.04)] text-gray-400",
};

const iconColors: Record<InlineNoticeVariant, string> = {
  info: "text-blue-400",
  success: "text-emerald-400",
  warning: "text-amber-400",
  danger: "text-red-400",
  neon: "text-[#00ff41]",
};

export function InlineNotice({ children, title, icon, variant = "neon", className = "" }: InlineNoticeProps) {
  return (
    <div className={["flex gap-2.5 rounded-xl border px-3 py-2.5 text-[11px] leading-relaxed", variants[variant], className].join(" ")}>
      {icon && <div className={["mt-0.5 shrink-0", iconColors[variant]].join(" ")}>{icon}</div>}
      <div className="min-w-0">
        {title && <p className="mb-0.5 text-xs font-semibold text-gray-200">{title}</p>}
        <div>{children}</div>
      </div>
    </div>
  );
}
