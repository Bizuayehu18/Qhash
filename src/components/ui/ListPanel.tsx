import type { ReactNode } from "react";

interface ListPanelProps {
  children: ReactNode;
  divided?: boolean;
  className?: string;
}

export function ListPanel({ children, divided = true, className = "" }: ListPanelProps) {
  return (
    <div
      className={[
        "overflow-hidden rounded-xl border border-[#1a1a1a] bg-[#111]",
        divided ? "divide-y divide-[#1a1a1a]" : "",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}
