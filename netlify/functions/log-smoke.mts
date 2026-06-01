import type { Config } from "@netlify/functions";

// TEMPORARY DIAGNOSTIC — Netlify logging smoke test.
// Marker: QHASH_LOG_SMOKE_20260601
// Purpose: prove where Netlify runtime console output lands and whether
// console.log / console.info / console.warn / console.error are each visible
// in the Netlify Function log UI. This function has no DB or external fetch,
// so its logs cannot be lost to a hung/timed-out invocation.
// Remove in a follow-up cleanup PR once logging visibility is confirmed.
const MARKER = "QHASH_LOG_SMOKE_20260601";

function line(level: string) {
  return JSON.stringify({
    marker: MARKER,
    source: "log-smoke",
    level,
    timestamp: new Date().toISOString(),
  });
}

export default async () => {
  console.log(line("log"));
  console.info(line("info"));
  console.warn(line("warn"));
  console.error(line("error"));

  return Response.json({ ok: true, marker: MARKER });
};

export const config: Config = {
  path: "/api/log-smoke",
  method: "GET",
};
