import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getSupportSettingsFn } from "@/lib/server/support-settings.js";

export const Route = createFileRoute("/support")({
  component: SupportRedirectPage,
});

function SupportRedirectPage() {
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let active = true;

    void getSupportSettingsFn({ data: {} })
      .then((result) => {
        if (!active) return;

        if (result.isConfigured && result.telegramUrl) {
          window.location.replace(result.telegramUrl);
          return;
        }

        setUnavailable(true);
      })
      .catch((err) => {
        console.error("[QHash] Support redirect failed:", err);

        if (active) {
          setUnavailable(true);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#050505] px-4 text-gray-100">
      {unavailable && (
        <div className="w-full max-w-sm rounded-2xl border border-[#1f1f1f] bg-[#111] p-4 text-center">
          <h1 className="text-base font-bold text-gray-100">Support contact unavailable</h1>
          <p className="mt-1 text-xs leading-relaxed text-gray-500">
            Telegram support is not configured yet. Please check back later.
          </p>
        </div>
      )}
    </main>
  );
}
