import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/Button.js";
import { Input } from "@/components/ui/Input.js";
import { Badge } from "@/components/ui/Badge.js";
import { HeadphonesIcon, MessageSquare } from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { getSafeErrorMessage } from "@/lib/errors.js";
import { useAuthStore } from "@/store/authStore.js";
import { submitTicketFn, getTicketsFn } from "@/lib/server/support.js";

export const Route = createFileRoute("/_app/support")({
  component: SupportPage,
});

type Ticket = Awaited<ReturnType<typeof getTicketsFn>>[number];

function SupportPage() {
  const { user } = useAuthStore();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.id || !subject.trim() || !message.trim()) return;

    setSubmitting(true);
    try {
      const { ticket } = await submitTicketFn({
        data: { userId: user.id, subject, message },
      });
      setTickets((prev) => [ticket, ...prev]);
      toast.success("Ticket submitted. We'll respond within 24 hours.");
      setSubject("");
      setMessage("");
    } catch (err) {
      toast.error(getSafeErrorMessage(err, "SUPPORT").message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold">Support</h1>
        <p className="text-xs text-gray-500 mt-1">Get help from our team</p>
      </div>

      {/* Submit ticket */}
      <div className="bg-[#111] rounded-xl border border-[rgba(0,255,65,0.15)] p-4">
        <div className="flex items-center gap-2 mb-4">
          <HeadphonesIcon size={14} className="text-[#00ff41]" />
          <span className="text-xs font-semibold">Submit a Ticket</span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Subject"
            type="text"
            placeholder="Brief description of your issue"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            required
          />
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-gray-300">Message</label>
            <textarea
              rows={4}
              placeholder="Describe your issue in detail..."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              required
              className="w-full bg-[#0a0a0a] border border-[#1f1f1f] rounded-xl text-sm text-gray-100 placeholder:text-gray-600 px-3 py-2.5 resize-none focus:outline-none focus:border-[rgba(0,255,65,0.5)] transition-colors"
            />
          </div>
          <Button type="submit" fullWidth disabled={!subject.trim() || !message.trim()} loading={submitting}>
            Send Ticket
          </Button>
        </form>
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
