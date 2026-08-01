import {
  TRANSACTION_HISTORY_FILTERS,
  type TransactionHistoryFilter,
} from "../../domain/transaction-history.js";

type TransactionFilterTabsProps = {
  activeFilter: TransactionHistoryFilter;
  onFilterChange: (filter: TransactionHistoryFilter) => void;
};

export function TransactionFilterTabs({
  activeFilter,
  onFilterChange,
}: TransactionFilterTabsProps) {
  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 hide-scrollbar lg:mx-0 lg:px-0">
      {TRANSACTION_HISTORY_FILTERS.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onFilterChange(tab.key)}
          className={`shrink-0 rounded-full border px-3 py-1.5 text-[11px] transition-colors card-press ${
            activeFilter === tab.key
              ? "border-[rgba(0,255,65,0.3)] bg-[rgba(0,255,65,0.08)] text-[#00ff41]"
              : "border-[#1f1f1f] text-gray-500"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
