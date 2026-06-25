import type { ReactNode } from "react";

export interface PillTabItem {
  key: string;
  label: ReactNode;
  count?: number | string;
}

interface PillTabsProps {
  tabs: PillTabItem[];
  activeKey: string;
  onChange: (key: string) => void;
  className?: string;
}

export function PillTabs({ tabs, activeKey, onChange, className = "" }: PillTabsProps) {
  return (
    <div className={["flex gap-2 overflow-x-auto hide-scrollbar -mx-4 px-4 pb-1 lg:mx-0 lg:px-0", className].join(" ")}>
      {tabs.map((tab) => {
        const active = tab.key === activeKey;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onChange(tab.key)}
            className={[
              "shrink-0 rounded-full border px-3 py-1.5 text-[11px] transition-colors card-press",
              active
                ? "border-[rgba(0,255,65,0.3)] bg-[rgba(0,255,65,0.08)] text-[#00ff41]"
                : "border-[#1f1f1f] text-gray-500 hover:border-[#2a2a2a] hover:text-gray-300",
            ].join(" ")}
          >
            <span>{tab.label}</span>
            {tab.count !== undefined && <span className="ml-1 text-[10px] opacity-70">{tab.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
