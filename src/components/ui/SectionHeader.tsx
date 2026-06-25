import type { ReactNode } from "react";

interface SectionHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function SectionHeader({ title, description, action, className = "" }: SectionHeaderProps) {
  return (
    <div className={["flex items-end justify-between gap-3", className].join(" ")}>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold leading-tight text-gray-100">{title}</h2>
        {description && <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
