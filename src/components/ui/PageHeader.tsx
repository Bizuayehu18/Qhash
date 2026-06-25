import type { ReactNode } from "react";

interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  icon?: ReactNode;
  badge?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  eyebrow,
  icon,
  badge,
  action,
  className = "",
}: PageHeaderProps) {
  return (
    <div className={["flex items-start justify-between gap-3", className].join(" ")}>
      <div className="flex min-w-0 items-start gap-3">
        {icon && (
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-[rgba(0,255,65,0.18)] bg-[rgba(0,255,65,0.07)] text-[#00ff41]">
            {icon}
          </div>
        )}
        <div className="min-w-0">
          {eyebrow && (
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#00ff41]/70">
              {eyebrow}
            </p>
          )}
          <h1 className="truncate text-lg font-bold leading-tight text-gray-100">{title}</h1>
          {description && <p className="mt-1 text-xs leading-relaxed text-gray-500">{description}</p>}
        </div>
      </div>
      {(badge || action) && (
        <div className="flex shrink-0 items-center gap-2">
          {badge}
          {action}
        </div>
      )}
    </div>
  );
}
