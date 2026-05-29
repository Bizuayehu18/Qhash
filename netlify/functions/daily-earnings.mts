import { createClient } from "@supabase/supabase-js";
import type { Config } from "@netlify/functions";
import { processAllEarnings } from "./lib/process-all-earnings.mts";

export default async (req: Request) => {
  const supabaseUrl =
    Netlify.env.get("VITE_SUPABASE_URL") ??
    Netlify.env.get("SUPABASE_URL") ??
    "";
  const serviceRoleKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      JSON.stringify({
        fn: "daily-earnings",
        step: "config_error",
        ts: new Date().toISOString(),
        error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
      })
    );
    return;
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  await processAllEarnings(admin, "scheduled");
};

export const config: Config = {
  schedule: "0 21 * * *",
};
