import { createServerFn } from "@tanstack/react-start";
import { getAdminClient } from "./supabase-admin.js";
import { throwSafe } from "../errors.js";

function validateAccessToken(data: unknown): { accessToken: string } {
  if (!data || typeof data !== "object") throwSafe("WALLET", "Unable to load wallet.", "Invalid request data");
  const { accessToken } = data as Record<string, unknown>;
  if (typeof accessToken !== "string" || accessToken.length === 0)
    throwSafe("WALLET", "Unable to load wallet.", "Missing access token");
  return { accessToken };
}

export const getWalletBalanceFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => validateAccessToken(data))
  .handler(async ({ data }) => {
    const admin = getAdminClient();

    // Derive the caller identity from the session access token. The client
    // never supplies the user id used for the wallet query below.
    const {
      data: { user: authUser },
      error: authError,
    } = await admin.auth.getUser(data.accessToken);
    if (authError || !authUser)
      throwSafe("WALLET", "Unable to load wallet.", "Invalid or expired access token");

    const { data: wallet } = await admin
      .from("wallets")
      .select("balance, updated_at")
      .eq("user_id", authUser.id)
      .single();

    return {
      balance: wallet?.balance ?? 0,
      updatedAt: wallet?.updated_at ?? null,
    };
  });
