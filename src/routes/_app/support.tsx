import { createFileRoute } from "@tanstack/react-router";
import { HeadphonesIcon, MessageSquare, Info } from "lucide-react";

export const Route = createFileRoute("/_app/support")({
  component: SupportPage,
});

function SupportPage() {
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

      {/* Tickets list — coming soon */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <MessageSquare size={14} className="text-gray-500" />
          <h2 className="text-sm font-semibold">My Tickets</h2>
        </div>

        <div className="bg-[#111] rounded-xl border border-[#1a1a1a] p-8 text-center text-xs text-gray-600">
          Ticket history is coming soon.
        </div>
      </div>
    </div>
  );
}
