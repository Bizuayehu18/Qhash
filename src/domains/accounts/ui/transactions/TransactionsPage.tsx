import { TransactionFilterTabs } from "./TransactionFilterTabs.js";
import { TransactionHistoryList } from "./TransactionHistoryList.js";
import { useTransactionHistory } from "./useTransactionHistory.js";

export function TransactionsPage() {
  const {
    activeFilter,
    loaded,
    rows,
    setActiveFilter,
  } = useTransactionHistory();

  return (
    <div className="space-y-4 lg:mx-auto lg:max-w-3xl">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Transactions</h1>
        {loaded && rows.length > 0 && (
          <span className="font-mono text-[10px] text-gray-600">
            {rows.length} records
          </span>
        )}
      </div>

      <TransactionFilterTabs
        activeFilter={activeFilter}
        onFilterChange={setActiveFilter}
      />
      <TransactionHistoryList loaded={loaded} rows={rows} />
    </div>
  );
}
