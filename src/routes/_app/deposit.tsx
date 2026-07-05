import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "@/components/ui/Badge.js";
import { EmptyState } from "@/components/ui/EmptyState.js";
import { ListPanel } from "@/components/ui/ListPanel.js";
import { ListRow } from "@/components/ui/ListRow.js";
import { SectionHeader } from "@/components/ui/SectionHeader.js";
import {
  ArrowDownCircle,
  Building2,
  CheckCircle,
  ChevronRight,
  Clock,
  Info,
  Smartphone,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { withTimeout } from "@/lib/async.js";
import { formatDateTime } from "@/lib/format.js";
import type { PaymentMethodType } from "@/lib/database.types.js";
import { getUserDepositsFn } from "@/lib/server/deposits.js";
import { getPaymentMethodsFn } from "@/lib/server/payment-methods.js";
import { useAuthStore } from "@/store/authStore.js";

export const Route = createFileRoute("/_app/deposit")({
  component: DepositPage,
});

type DepositMethodType = Extract<PaymentMethodType, "cbe" | "telebirr">;
type PaymentMethod = {
  id: string;
  type: PaymentMethodType;
  account_name: string;
  account_number: string;
  instructions: string | null;
  is_active: boolean;
};
type UserDeposit = Awaited<ReturnType<typeof getUserDepositsFn>>[number];

type MethodCardMeta = {
  type: DepositMethodType;
  label: string;
  title: string;
  subtitle: string;
  description: string;
  href: string;
  prefix: string;
  verificationLabel: string;
  verificationVariant: "success" | "warning";
  icon: React.ReactNode;
};

const METHOD_LOAD_TIMEOUT_MS = 10_000;
const HISTORY_LOAD_TIMEOUT_MS = 10_000;
const AUTO_RETRY_DELAY_MS = 1_500;
const MAX_AUTO_RETRIES = 2;

const METHOD_CARDS: MethodCardMeta[] = [
  {
    type: "cbe",
    label: "CBE",
    title: "CBE Bank Deposit",
    subtitle: "Bank transfer",
    description: "Use your CBE receipt reference for fast verification after transfer.",
    href: "/deposit/cbe",
    prefix: "FT",
    verificationLabel: "Auto verification",
    verificationVariant: "success",
    icon: <Building2 size={18} />,
  },
  {
    type: "telebirr",
    label: "TeleBirr",
    title: "TeleBirr Deposit",
    subtitle: "Wallet transfer",
    description: "Send by TeleBirr, then submit your transaction ID for review.",
    href: "/deposit/telebirr",
    prefix: "D",
    verificationLabel: "Manual review",
    verificationVariant: "warning",
    icon: <Smartphone size={18} />,
  },
];

const METHOD_LABELS: Record<string, string> = {
  cbe: "CBE",
  telebirr: "TeleBirr",
};

function getMethodLabel(type: string): string {
  return METHOD_LABELS[type] ?? type.toUpperCase();
}

function formatAmount(value: number): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function shortReference(value: string | null | undefined): string {
  const ref = value?.trim();
  if (!ref) return "Ref unavailable";
  if (ref.length <= 10) return `Ref ${ref}`;
  return `Ref …${ref.slice(-6)}`;
}

function DepositPage() {
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.session?.access_token ?? null);

  const [methods, setMethods] = useState<PaymentMethod[]>([]);
  const [methodsLoaded, setMethodsLoaded] = useState(false);
  const [deposits, setDeposits] = useState<UserDeposit[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  const mountedRef = useRef(true);
  const methodsLoadingRef = useRef(false);
  const methodsRetryCountRef = useRef(0);
  const methodsRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyLoadingRef = useRef(false);
  const historyRetryCountRef = useRef(0);
  const historyRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearMethodsRetryTimer = useCallback(() => {
    if (methodsRetryTimerRef.current) {
      clearTimeout(methodsRetryTimerRef.current);
      methodsRetryTimerRef.current = null;
    }
  }, []);

  const clearHistoryRetryTimer = useCallback(() => {
    if (historyRetryTimerRef.current) {
      clearTimeout(historyRetryTimerRef.current);
      historyRetryTimerRef.current = null;
    }
  }, []);

  const scheduleMethodsRetry = useCallback(
    (loadFn: () => void) => {
      clearMethodsRetryTimer();
      if (methodsRetryCountRef.current >= MAX_AUTO_RETRIES) return;
      methodsRetryCountRef.current += 1;
      methodsRetryTimerRef.current = setTimeout(loadFn, AUTO_RETRY_DELAY_MS);
    },
    [clearMethodsRetryTimer],
  );

  const scheduleHistoryRetry = useCallback(
    (loadFn: () => void) => {
      clearHistoryRetryTimer();
      if (historyRetryCountRef.current >= MAX_AUTO_RETRIES) return;
      historyRetryCountRef.current += 1;
      historyRetryTimerRef.current = setTimeout(loadFn, AUTO_RETRY_DELAY_MS);
    },
    [clearHistoryRetryTimer],
  );

  const loadMethods = useCallback(
    async (options?: { resetRetryCount?: boolean }) => {
      if (methodsLoadingRef.current) return;
      if (options?.resetRetryCount) methodsRetryCountRef.current = 0;

      clearMethodsRetryTimer();
      methodsLoadingRef.current = true;

      try {
        const result = await withTimeout(
          getPaymentMethodsFn({ data: { activeOnly: true } }),
          METHOD_LOAD_TIMEOUT_MS,
          "Payment methods request timed out.",
        );

        if (!mountedRef.current) return;

        setMethods(result as PaymentMethod[]);
        setMethodsLoaded(true);
        methodsRetryCountRef.current = 0;
      } catch (err) {
        console.error("[QHash] Deposit payment methods background refresh failed:", err);

        if (!mountedRef.current) return;
        scheduleMethodsRetry(() => void loadMethods());
      } finally {
        methodsLoadingRef.current = false;
      }
    },
    [clearMethodsRetryTimer, scheduleMethodsRetry],
  );

  const loadHistory = useCallback(
    async (options?: { resetRetryCount?: boolean }) => {
      if (historyLoadingRef.current) return;
      if (options?.resetRetryCount) historyRetryCountRef.current = 0;
      if (!user?.id || !accessToken) return;

      clearHistoryRetryTimer();
      historyLoadingRef.current = true;

      try {
        const result = await withTimeout(
          getUserDepositsFn({ data: { accessToken } }),
          HISTORY_LOAD_TIMEOUT_MS,
          "Deposit history request timed out.",
        );

        if (!mountedRef.current) return;

        setDeposits(result);
        setHistoryLoaded(true);
        historyRetryCountRef.current = 0;
      } catch (err) {
        console.error("[QHash] Deposit history background refresh failed:", err);

        if (!mountedRef.current) return;
        scheduleHistoryRetry(() => void loadHistory());
      } finally {
        historyLoadingRef.current = false;
      }
    },
    [accessToken, clearHistoryRetryTimer, scheduleHistoryRetry, user?.id],
  );

  useEffect(() => {
    mountedRef.current = true;
    void loadMethods({ resetRetryCount: true });
    void loadHistory({ resetRetryCount: true });

    return () => {
      mountedRef.current = false;
      clearMethodsRetryTimer();
      clearHistoryRetryTimer();
    };
  }, [clearHistoryRetryTimer, clearMethodsRetryTimer, loadHistory, loadMethods]);

  useEffect(() => {
    const refresh = () => {
      void loadMethods({ resetRetryCount: true });
      void loadHistory({ resetRetryCount: true });
    };

    const handleVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };

    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("online", refresh);

    return () => {
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("online", refresh);
    };
  }, [loadHistory, loadMethods]);

  const methodCounts = useMemo(
    () => METHOD_CARDS.reduce(
      (acc, meta) => {
        acc[meta.type] = methods.filter((method) => method.type === meta.type).length;
        return acc;
      },
      {} as Record<DepositMethodType, number>,
    ),
    [methods],
  );

  return (
    <div className="space-y-3 pb-20 lg:mx-auto lg:grid lg:max-w-5xl lg:grid-cols-12 lg:items-start lg:gap-5 lg:space-y-0">
      <div className="lg:col-span-12">
        <DepositHero />
      </div>

      <div className="space-y-3 lg:col-span-7 xl:col-span-8">
        <MethodCardGrid
          methodsLoaded={methodsLoaded}
          methodCounts={methodCounts}
        />
        <DepositNoticeLine />
      </div>

      <div className="lg:col-span-5 xl:col-span-4">
        <DepositHistory deposits={deposits} historyLoaded={historyLoaded} />
      </div>
    </div>
  );
}

function DepositHero() {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-[rgba(0,255,65,0.16)] bg-[#111] p-4 shadow-[0_0_30px_rgba(0,255,65,0.04)]">
      <div className="pointer-events-none absolute -right-12 -top-16 h-36 w-36 rounded-full bg-[rgba(0,255,65,0.08)] blur-3xl" />
      <div className="relative flex items-start gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-[rgba(0,255,65,0.2)] bg-[linear-gradient(145deg,rgba(0,255,65,0.14),rgba(0,255,65,0.045))] text-[#00ff41]">
          <ArrowDownCircle size={18} />
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#00ff41]/70">
            Deposit Center
          </p>
          <h1 className="mt-1 text-xl font-black leading-tight text-gray-100">Choose how to deposit</h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-gray-500">
            Fund your QHash wallet through a dedicated CBE or TeleBirr deposit page.
          </p>
        </div>
      </div>
    </section>
  );
}

function MethodCardGrid({
  methodsLoaded,
  methodCounts,
}: {
  methodsLoaded: boolean;
  methodCounts: Record<DepositMethodType, number>;
}) {
  return (
    <section className="space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-gray-600">
            Funding channels
          </p>
          <h2 className="text-sm font-bold text-gray-100">Select deposit method</h2>
        </div>
        <Badge variant="neon" className="shrink-0 text-[9px]">2 methods</Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {METHOD_CARDS.map((meta) => (
          <DepositMethodCard
            key={meta.type}
            meta={meta}
            methodsLoaded={methodsLoaded}
            accountCount={methodCounts[meta.type] ?? 0}
          />
        ))}
      </div>
    </section>
  );
}

function DepositMethodCard({
  meta,
  methodsLoaded,
  accountCount,
}: {
  meta: MethodCardMeta;
  methodsLoaded: boolean;
  accountCount: number;
}) {
  return (
    <a
      href={meta.href}
      className="group relative overflow-hidden rounded-2xl border border-[rgba(0,255,65,0.14)] bg-[#111] p-3.5 shadow-[0_0_24px_rgba(0,255,65,0.025)] transition-colors hover:border-[rgba(0,255,65,0.28)] hover:bg-[rgba(0,255,65,0.025)] card-press"
    >
      <div className="pointer-events-none absolute -right-10 -top-12 h-28 w-28 rounded-full bg-[rgba(0,255,65,0.06)] blur-2xl" />
      <div className="relative space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-[rgba(0,255,65,0.18)] bg-[rgba(0,255,65,0.06)] text-[#00ff41]">
              {meta.icon}
            </span>
            <span className="min-w-0">
              <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-[#00ff41]/70">
                {meta.subtitle}
              </span>
              <span className="mt-0.5 block truncate text-sm font-black text-gray-100">
                {meta.title}
              </span>
            </span>
          </div>

          <ChevronRight size={16} className="mt-2 shrink-0 text-gray-600 transition-colors group-hover:text-[#00ff41]" />
        </div>

        <p className="text-[11px] leading-relaxed text-gray-500">{meta.description}</p>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={meta.verificationVariant} className="rounded-full text-[9px]">
            {meta.verificationLabel}
          </Badge>
          <span className="rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 font-mono text-[9px] font-semibold text-gray-400">
            Ref starts {meta.prefix}
          </span>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[#1a1a1a] pt-3">
          <span className="text-[10px] text-gray-600">
            {methodsLoaded ? `${accountCount} active account${accountCount === 1 ? "" : "s"}` : "Checking accounts…"}
          </span>
          <span className="text-[10px] font-semibold text-[#00ff41]">
            Deposit with {meta.label}
          </span>
        </div>
      </div>
    </a>
  );
}

function DepositNoticeLine() {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-[rgba(0,255,65,0.14)] bg-[rgba(0,255,65,0.035)] px-3 py-2.5">
      <Info size={13} className="mt-0.5 shrink-0 text-[#00ff41]" />
      <p className="text-[10px] leading-relaxed text-gray-500">
        <span className="font-semibold text-[#00ff41]">Transfer first</span>
        <span> · Open a method page, copy the receiving account, then submit your transaction reference.</span>
      </p>
    </div>
  );
}

function DepositHistory({
  deposits,
  historyLoaded,
}: {
  deposits: UserDeposit[];
  historyLoaded: boolean;
}) {
  return (
    <section className="mt-1 space-y-2.5 lg:mt-0">
      <SectionHeader
        title="Recent Deposits"
        action={
          deposits.length > 0 ? (
            <Badge variant="default" className="shrink-0 text-[9px]">
              {deposits.length}
            </Badge>
          ) : null
        }
      />

      {!historyLoaded && deposits.length === 0 ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-16 rounded-xl" />
          ))}
        </div>
      ) : historyLoaded && deposits.length === 0 ? (
        <ListPanel divided={false}>
          <EmptyState
            icon={<Clock size={22} />}
            title="No deposits yet"
            description="Submitted deposits will appear here."
            className="py-10"
          />
        </ListPanel>
      ) : (
        <ListPanel>
          {deposits.map((deposit) => (
            <DepositHistoryItem key={deposit.id} deposit={deposit} />
          ))}
        </ListPanel>
      )}
    </section>
  );
}

function DepositHistoryItem({ deposit }: { deposit: UserDeposit }) {
  const hasAmount = deposit.amount > 0;
  const isApproved = deposit.status === "approved";
  const isRejected = deposit.status === "rejected";
  const isPending = deposit.status === "pending";
  const amountText = hasAmount
    ? `+${formatAmount(deposit.amount)} ETB`
    : isRejected
      ? "Rejected"
      : isPending
        ? "Pending"
        : "Reviewing";
  const amountClass = isApproved
    ? "text-[#00ff41]"
    : isRejected
      ? "text-red-400"
      : isPending
        ? "text-amber-300"
        : "text-gray-300";
  const iconClass = isApproved
    ? "text-[#00ff41]"
    : isRejected
      ? "text-red-400"
      : "text-amber-300";

  return (
    <ListRow
      icon={<ArrowDownCircle size={15} className={iconClass} />}
      title={
        <div className="flex min-w-0 items-center gap-2">
          <p className="truncate text-sm font-bold text-gray-100">
            {getMethodLabel(deposit.method_type)} Deposit
          </p>
          <DepositStatusBadge status={deposit.status} />
        </div>
      }
      description={`${shortReference(deposit.transaction_reference)} · ${formatDateTime(deposit.created_at)}`}
      right={<p className={`font-mono text-xs font-semibold ${amountClass}`}>{amountText}</p>}
    />
  );
}

function DepositStatusBadge({ status }: { status: string }) {
  const config: Record<
    string,
    { label: string; variant: "success" | "warning" | "danger" | "default"; icon: React.ReactNode }
  > = {
    approved: { label: "Done", variant: "success", icon: <CheckCircle size={10} /> },
    pending: { label: "Pending", variant: "warning", icon: <Clock size={10} /> },
    rejected: { label: "Failed", variant: "danger", icon: <XCircle size={10} /> },
  };
  const { label, variant, icon } = config[status] ?? {
    label: status,
    variant: "default" as const,
    icon: null,
  };

  return (
    <Badge variant={variant} className="shrink-0 text-[9px]">
      <span className="flex items-center gap-1">
        {icon}
        {label}
      </span>
    </Badge>
  );
}
