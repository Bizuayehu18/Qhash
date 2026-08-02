import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { AmountText } from "@/components/ui/AmountText.js";
import { EmptyState } from "@/components/ui/EmptyState.js";
import { ListPanel } from "@/components/ui/ListPanel.js";
import { ListRow } from "@/components/ui/ListRow.js";
import { SectionHeader } from "@/components/ui/SectionHeader.js";
import {
  isOutgoingTx,
  TxIcon,
  txSubtitle,
  txTitle,
} from "@/components/ui/TransactionHelpers.js";
import { formatDateTime } from "@/shared/formatting/date-time.js";
import type { DashboardData } from "../../application/dashboard-browser-service.js";
import { getRecentDashboardTransactions } from "./dashboard-format.js";

export function DashboardRecentTransactions({
  hasCompletedInvestments,
  hasDashboardData,
  recentTransactions,
}: {
  hasCompletedInvestments: boolean;
  hasDashboardData: boolean;
  recentTransactions: DashboardData["recentTransactions"];
}) {
  return (
    <div className={hasCompletedInvestments ? "lg:col-span-8" : "lg:col-span-12"}>
      <SectionHeader
        title="Recent Transactions"
        action={
          <Link to="/transactions" className="flex items-center gap-0.5 text-[10px] text-gray-500">
            View All <ChevronRight size={12} />
          </Link>
        }
        className="mb-3"
      />

      {!hasDashboardData ? (
        <div className="rounded-xl border border-[#1a1a1a] bg-[#111] p-6">
          <div className="skeleton h-3 w-36 rounded" />
        </div>
      ) : recentTransactions.length === 0 ? (
        <div className="rounded-xl border border-[#1a1a1a] bg-[#111]">
          <EmptyState title="No transactions yet" className="py-10" />
        </div>
      ) : (
        <ListPanel>
          {getRecentDashboardTransactions(recentTransactions).map((transaction) => {
            const signedAmount = isOutgoingTx(transaction.type)
              ? -Math.abs(transaction.amount)
              : Math.abs(transaction.amount);
            const formattedCreatedAt = formatDateTime(transaction.created_at);

            return (
              <ListRow
                key={transaction.id}
                icon={<TxIcon type={transaction.type} />}
                title={txTitle(transaction.type)}
                description={txSubtitle(transaction, formattedCreatedAt)}
                meta={formattedCreatedAt}
                right={<AmountText value={signedAmount} showSign size="sm" />}
              />
            );
          })}
        </ListPanel>
      )}
    </div>
  );
}
