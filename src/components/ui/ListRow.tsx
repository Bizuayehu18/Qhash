import type { ReactNode } from "react";

interface ListRowProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  right?: ReactNode;
  unread?: boolean;
  onClick?: () => void;
  className?: string;
}

export function ListRow({ icon, title, description, meta, right, unread, onClick, className = "" }: ListRowProps) {
  const content = (
    <>
      {icon && (
        <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/[0.05]">
          {icon}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="min-w-0 text-xs font-medium text-gray-200">{title}</div>
        {description && <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">{description}</p>}
        {meta && <p className="mt-1 text-[10px] text-gray-700">{meta}</p>}
      </div>
      {right && <div className="shrink-0 text-right">{right}</div>}
    </>
  );

  const rowClassName = [
    "flex w-full gap-3 px-4 py-3 text-left transition-colors",
    unread ? "bg-[rgba(0,255,65,0.02)]" : "",
    onClick ? "card-press hover:bg-white/[0.025]" : "",
    className,
  ].join(" ");

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={rowClassName}>
        {content}
      </button>
    );
  }

  return <div className={rowClassName}>{content}</div>;
}
