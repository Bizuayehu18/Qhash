import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "@/components/ui/Badge.js";
import { HeadphonesIcon, MessageSquare, Info } from "lucide-react";
import { useState, useEffect } from "react";
import { useAuthStore } from "@/store/authStore.js";
import { getTicketsFn } from "@/lib/server/support.js";

export const Route = createFileRoute("/_app/support")({
  component: SupportPage,
});

type Ticket = Awaited<ReturnType<typeof getTicketsFn>>[number];

function SupportPage() {
  const { user } = useAuthStore();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) return;
    setLoading(true);
    getTicketsFn({ data: { userId: user.id } })
      .then(setTickets)
      .catch((err) => {
        console.error("Failed to load tickets:", err);
      })
      .finally(() => setLoading(false));
  }, [user?.id]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold">Support</h1>
        <p className="text-xs text-gray-500 mt-1">Get help from our team</p>
      </div>

      {/* Coming soon notice */}
      <div className="bg-[#111] rounded-xl border border-[rgba(0,255,65,0.15)] p-4">
        <div className="flex items-center gap-2 mb-3">
          <HeadphonesIcon size={14} className="text-[#00ff41]" />
          <span className="text-xs font-semibold">Submit a Ticket</span>
        </div>
        <div className="flex gap-2.5 p-3 rounded-xl bg-[rgba(0,255,65,0.04)] border border-[rgba(0,255,65,0.1)]">
          <Info size={15} className="text-[#00ff41] shrink-0 mt-0.5" />
          <p className="text-[11px] text-gray-400 leading-relaxed">
            Support tickets are coming soon. Please contact admin through the official
            Telegram/support channel for now.
          </p>
        </div>
      </div>

      {/* Tickets list */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <MessageSquare size={14} className="text-gray-500" />
          <h2 className="text-sm font-semibold">My Tickets</h2>
        </div>

        {loading ? (
          <div className="space-y-2">
            {[1, 2].map((i) => <div key={i} className="skeleton h-20 rounded-xl" />)}
          </div>
        ) : tickets.length === 0 ? (
          <div className="bg-[#111] rounded-xl border border-[#1a1a1a] p-8 text-center text-xs text-gray-600">
            No tickets yet
          </div>
        ) : (
          <div className="space-y-3">
            {tickets.map((ticket) => (
              <div key={ticket.id} className="bg-[#111] rounded-xl border border-[#1a1a1a] p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-xs text-gray-200 truncate pr-2">{ticket.subject}</span>
                  <TicketStatusBadge status={ticket.status} />
                </div>
                <p className="text-[11px] text-gray-500 line-clamp-2 mb-2">{ticket.message}</p>
                {ticket.adminReply && (
                  <div className="mt-2 p-2.5 rounded-lg bg-[rgba(0,255,65,0.04)] border border-[rgba(0,255,65,0.1)]">
                    <p className="text-[10px] text-gray-500 mb-1">Admin reply:</p>
                    <p className="text-[11px] text-gray-300">{ticket.adminReply}</p>
                  </div>
                )}
                <p className="text-[10px] text-gray-600 mt-2">
                  {new Date(ticket.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TicketStatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; variant: "neon" | "info" | "warning" | "default" | "success" }> = {
    open: { label: "Open", variant: "info" },
    in_progress: { label: "In Progress", variant: "warning" },
    resolved: { label: "Resolved", variant: "success" },
    closed: { label: "Closed", variant: "default" },
  };
  const { label, variant } = config[status] ?? { label: status, variant: "default" as const };
  return <Badge variant={variant}>{label}</Badge>;
}
