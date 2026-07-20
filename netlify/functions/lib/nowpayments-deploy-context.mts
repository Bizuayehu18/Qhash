import type { Context } from "@netlify/functions";

export function isPublishedProductionDeployContext(
  context: Context | null | undefined,
): boolean {
  try {
    const deploy = context?.deploy;
    return deploy?.context === "production" && deploy?.published === true;
  } catch {
    return false;
  }
}
