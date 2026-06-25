import type { ReactNode } from "react";
import { Card } from "./Card.js";

interface StatTileProps {
  icon?: ReactNode;
  label: ReactNode;
  value: ReactNode;
  caption?: ReactNode;
  accent?: boolean;
  loading?: boolean;
  className?: string;
}

export function StatTile({ icon, label, value, caption, accent, loading, className = "" }: StatTileProps) {
  return (
    <Card padding="sm" className={className}>
      <div className="flex items-center gap-2.5">
        {icon && (
          <div className={accent ? "text-[#00ff41]" : "text-gray-500"}>
            {icon}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[10px] uppercase tracking-[0.16em] text-gray-600">{label}</p>
          <div className={["mt-0.5 text-base font-bold leading-tight", accent ? "text-[#00ff41]" : "text-gray-100"].join(" ")}>
            {loading ? <span className="skeleton inline-block h-5 w-16 rounded" /> : value}
          </div>
          {caption && <p className="mt-0.5 truncate text-[10px] text-gray-600">{caption}</p>}
        </div>
      </div>
    </Card>
  );
}
