import {
  ArrowDownCircle,
  Settings,
  ShieldCheck,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge.js";
import { AdminEtbAmount } from "./AdminEtbAmount.js";
import { useAdminOverview } from "./useAdminOverview.js";

type AdminOverviewPanelProps = Readonly<{
  accessToken: string | null | undefined;
  userId: string | null | undefined;
}>;

export function AdminOverviewPanel({
  accessToken,
  userId,
}: AdminOverviewPanelProps) {
  const { stats, statsLoaded } = useAdminOverview(userId, accessToken);

  return (
    <div className="space-y-4 lg:grid lg:grid-cols-12 lg:items-start lg:gap-5 lg:space-y-0">
      <div className="grid grid-cols-2 gap-3 lg:col-span-12 lg:grid-cols-4">
        {[
          {
            label: "Total Users",
            value: stats?.totalUsers,
            icon: <Users size={14} />,
          },
          {
            label: "Active Plans",
            value: stats?.activeInvestments,
            icon: <ShieldCheck size={14} />,
          },
          {
            label: "Pending Deposits",
            value: stats?.pendingDeposits,
            icon: <ArrowDownCircle size={14} />,
          },
          {
            label: "Revenue",
            value: stats?.totalRevenue !== undefined
              ? <AdminEtbAmount value={stats.totalRevenue} />
              : undefined,
            icon: <Settings size={14} />,
          },
        ].map((stat) => (
          <div
            key={stat.label}
            className="bg-[#111] rounded-xl border border-[#1a1a1a] p-3"
          >
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] text-gray-500">{stat.label}</p>
              <span className="text-gray-600">{stat.icon}</span>
            </div>
            {!statsLoaded ? (
              <span
                className="skeleton inline-block h-5 w-16 rounded"
                aria-label={`Loading ${stat.label}`}
              />
            ) : (
              <p className="text-lg font-bold">{stat.value ?? 0}</p>
            )}
          </div>
        ))}
      </div>

      <div className="lg:col-span-8">
        <h2 className="text-xs font-semibold text-gray-400 mb-2">
          Recent Users
        </h2>
        {!statsLoaded ? (
          <div className="space-y-2">
            {[1, 2, 3].map((index) => (
              <div key={index} className="skeleton h-12 rounded-xl" />
            ))}
          </div>
        ) : !stats?.recentUsers.length ? (
          <div className="bg-[#111] rounded-xl border border-[#1a1a1a] p-6 text-center text-xs text-gray-600">
            No users yet.
          </div>
        ) : (
          <div className="bg-[#111] rounded-xl border border-[#1a1a1a] divide-y divide-[#1a1a1a]">
            {stats.recentUsers.map((recentUser) => (
              <div
                key={recentUser.id}
                className="flex items-center justify-between px-4 py-2.5"
              >
                <div>
                  <p className="text-xs font-medium text-gray-200">
                    @{recentUser.username}
                  </p>
                  <p className="text-[10px] text-gray-600">
                    {recentUser.phone}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {recentUser.is_frozen ? (
                    <Badge variant="danger">Frozen</Badge>
                  ) : recentUser.is_admin ? (
                    <Badge variant="neon">Admin</Badge>
                  ) : (
                    <Badge variant="default">User</Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="lg:col-span-4">
        <h2 className="text-xs font-semibold text-gray-400 mb-2">
          Pending Withdrawals
        </h2>
        {!statsLoaded ? (
          <div className="skeleton h-16 rounded-xl" />
        ) : !stats?.pendingWithdrawalRecords.length ? (
          <div className="bg-[#111] rounded-xl border border-[#1a1a1a] p-6 text-center text-xs text-gray-600">
            No pending requests.
          </div>
        ) : (
          <div className="bg-[#111] rounded-xl border border-[#1a1a1a] divide-y divide-[#1a1a1a]">
            {stats.pendingWithdrawalRecords.map((withdrawal) => (
              <div
                key={withdrawal.id}
                className="flex items-center justify-between px-4 py-2.5"
              >
                <div>
                  <p className="text-xs font-medium text-gray-200">
                    @{withdrawal.username}
                  </p>
                  <p className="text-[10px] text-gray-600">
                    {new Date(withdrawal.createdAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </p>
                </div>
                <span className="text-xs text-red-400 font-mono">
                  <AdminEtbAmount value={withdrawal.amount} />
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
