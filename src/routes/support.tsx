import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { getSupportSettingsFn } from "@/lib/server/support-settings.js";

export const Route = createFileRoute("/support")({ component: SupportRedirectPage });

function SupportRedirectPage() {
  useEffect(() => {
    let active = true;
    void getSupportSettingsFn({ data: {} }).then((result) => {
      if (active && result.isConfigured && result.telegramUrl) {
        window.location.replace(result.telegramUrl);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  return <main className="min-h-screen bg-[#050505]" />;
}
