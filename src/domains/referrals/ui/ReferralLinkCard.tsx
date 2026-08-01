import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Link2 } from "lucide-react";
import { Card } from "@/components/ui/Card.js";

export function ReferralLinkCard({ username }: { username: string | null }) {
  const [copied, setCopied] = useState(false);
  const copyGenerationRef = useRef(0);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const referralLink = username && typeof window !== "undefined"
    ? `${window.location.origin}/register?ref=${username}`
    : null;

  const clearResetTimer = useCallback(() => {
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    copyGenerationRef.current += 1;
    setCopied(false);
    clearResetTimer();
    return () => {
      copyGenerationRef.current += 1;
      clearResetTimer();
    };
  }, [clearResetTimer, referralLink]);

  const handleCopy = useCallback(() => {
    if (!referralLink) return;
    const copyGeneration = copyGenerationRef.current;

    void navigator.clipboard.writeText(referralLink).then(() => {
      if (copyGenerationRef.current !== copyGeneration) return;
      setCopied(true);
      clearResetTimer();
      resetTimerRef.current = setTimeout(() => {
        if (copyGenerationRef.current === copyGeneration) setCopied(false);
      }, 2_000);
    }).catch(() => {
      // The browser owns clipboard permission; no account data changes on failure.
    });
  }, [clearResetTimer, referralLink]);

  return (
    <Card neon padding="sm" className="lg:col-span-12">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Link2 size={15} className="text-[#00ff41]" />
            <span className="text-xs font-semibold uppercase tracking-wider text-[#00ff41]">
              Your Referral Link
            </span>
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-gray-500">
            Share your link to grow your team.
          </p>
        </div>
      </div>

      {username ? (
        <>
          <div className="mb-2 flex items-center gap-2">
            <div className="flex-1 truncate rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] px-3 py-2 font-mono text-[11px] text-gray-300">
              {referralLink}
            </div>
            <button
              type="button"
              onClick={handleCopy}
              className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-lg bg-[#00ff41] transition-all active:scale-95"
              aria-label="Copy referral link"
            >
              {copied ? (
                <Check size={15} className="text-black" />
              ) : (
                <Copy size={15} className="text-black" />
              )}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] text-gray-600">Code:</span>
            <span className="rounded-md border border-[#1f1f1f] bg-[#0a0a0a] px-2 py-0.5 font-mono text-[11px] text-gray-400">
              {username}
            </span>
            {copied && (
              <span className="text-[10px] font-semibold text-[#00ff41]">
                Copied
              </span>
            )}
          </div>
        </>
      ) : (
        <p className="text-xs text-gray-500">
          Your referral code is being set up. Please try again shortly.
        </p>
      )}
    </Card>
  );
}
