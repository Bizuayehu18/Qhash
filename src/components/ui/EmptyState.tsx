import type { ReactNode } from "react";

interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className = "" }: EmptyStateProps) {
  return (
    <div className={["py-14 text-center", className].join(" ")}>
      {icon && <div className="mx-auto mb-3 flex justify-center text-gray-700">{icon}</div>}
      <p className="text-xs font-medium text-gray-500">{title}</p>
      {description && <p className="mx-auto mt-1 max-w-xs text-[11px] leading-relaxed text-gray-600">{description}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
