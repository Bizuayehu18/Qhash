import { createServerFn } from "@tanstack/react-start";
import { getAdminClient } from "./supabase-admin.js";
import type { PaymentMethodType } from "../database.types.js";
import { throwSafe } from "../errors.js";

// Verify a session access token belongs to an active (non-frozen) admin.
// Used for privileged payment-method operations (activeOnly:false listing and
// create/update); the caller identity is derived from the token server-side and
// the client-supplied id is never trusted (mirrors getAdminDepositsFn /
// getAdminStatsFn).
async function assertAdminToken(accessToken: string) {
  const admin = getAdminClient();
  const {
    data: { user: authUser },
    error: authError,
  } = await admin.auth.getUser(accessToken);
  if (authError || !authUser)
    throwSafe("PAYMENT", "Unauthorized.", "Invalid or expired access token");

  const { data: profile } = await admin
    .from("profiles")
    .select("is_admin, is_frozen")
    .eq("id", authUser.id)
    .single();
  if (!profile || profile.is_admin !== true || profile.is_frozen === true)
    throwSafe("PAYMENT", "Unauthorized.", "Non-admin or frozen admin attempted payment methods listing");
}

// Derive the receiver's last-8 digits used for CBE receipt URL generation.
// For CBE the value is computed from the account number (never client-supplied);
// for TeleBirr there is no such concept, so it is always null.
function deriveAccountLast8(type: PaymentMethodType, accountNumber: string): string | null {
  if (type === "cbe") {
    const digits = accountNumber.replace(/\D/g, "");
    if (digits.length < 8)
      throwSafe("PAYMENT", "CBE account number must contain at least 8 digits.", "CBE account number has fewer than 8 digits");
    return digits.slice(-8);
  }
  return null;
}

export const getPaymentMethodsFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throwSafe("PAYMENT", "Failed to load payment methods.", "Invalid request data");
    const { activeOnly, accessToken } = data as Record<string, unknown>;
    const activeOnlyResolved = activeOnly !== false;
    if (!activeOnlyResolved && (typeof accessToken !== "string" || !accessToken))
      throwSafe("PAYMENT", "Unauthorized.", "Missing access token for non-active listing");
    return {
      activeOnly: activeOnlyResolved,
      accessToken: typeof accessToken === "string" ? accessToken : undefined,
    };
  })
  .handler(async ({ data }) => {
    if (!data.activeOnly) {
      await assertAdminToken(data.accessToken as string);
    }
    const admin = getAdminClient();
    let query = admin
      .from("payment_methods")
      .select("*")
      .order("type")
      .order("created_at", { ascending: false });
    if (data.activeOnly) {
      query = query.eq("is_active", true);
    }
    const { data: rows, error } = await query;
    if (error) throwSafe("PAYMENT", "Failed to load payment methods.", `DB error: ${error.message}`);
    return rows ?? [];
  });

export const createPaymentMethodFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throwSafe("PAYMENT", "Failed to create payment method.", "Invalid request data");
    const { accessToken, type, accountName, accountNumber, instructions } =
      data as Record<string, unknown>;
    if (typeof accessToken !== "string" || !accessToken)
      throwSafe("PAYMENT", "Unauthorized.", "Missing access token for create payment method");
    if (type !== "cbe" && type !== "telebirr")
      throwSafe("PAYMENT", "Invalid payment method type.", "Invalid type: " + String(type));
    if (typeof accountName !== "string" || !accountName.trim())
      throwSafe("PAYMENT", "Account name is required.", "Missing account name");
    if (typeof accountNumber !== "string" || !accountNumber.trim())
      throwSafe("PAYMENT", "Account number is required.", "Missing account number");
    return {
      accessToken,
      type: type as PaymentMethodType,
      accountName: accountName.trim(),
      accountNumber: accountNumber.trim(),
      instructions:
        typeof instructions === "string" && instructions.trim()
          ? instructions.trim()
          : null,
    };
  })
  .handler(async ({ data }) => {
    await assertAdminToken(data.accessToken);
    // Derive last-8 server-side: CBE from the account number, TeleBirr is null.
    const accountLast8 = deriveAccountLast8(data.type, data.accountNumber);
    const admin = getAdminClient();
    const { data: row, error } = await admin
      .from("payment_methods")
      .insert({
        type: data.type,
        account_name: data.accountName,
        account_number: data.accountNumber,
        instructions: data.instructions,
        account_last_8: accountLast8,
      })
      .select()
      .single();
    if (error) {
      if (error.code === "23505")
        throwSafe("PAYMENT", "This account number already exists for this type.", "Duplicate account: " + error.message);
      throwSafe("PAYMENT", "Failed to create payment method.", `DB error: ${error.message}`);
    }
    return row;
  });

export const updatePaymentMethodFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throwSafe("PAYMENT", "Failed to update payment method.", "Invalid request data");
    const { accessToken, methodId, accountName, accountNumber, isActive, instructions } =
      data as Record<string, unknown>;
    if (typeof accessToken !== "string" || !accessToken)
      throwSafe("PAYMENT", "Unauthorized.", "Missing access token for update payment method");
    if (typeof methodId !== "string" || !methodId)
      throwSafe("PAYMENT", "Failed to update payment method.", "Missing method ID");
    return {
      accessToken,
      methodId,
      accountName:
        typeof accountName === "string" ? accountName.trim() : undefined,
      accountNumber:
        typeof accountNumber === "string" ? accountNumber.trim() : undefined,
      isActive: typeof isActive === "boolean" ? isActive : undefined,
      // undefined = do not update, null = explicitly clear, string = set trimmed
      // value (blank trims to null so admins can clear instructions).
      instructions:
        instructions === undefined
          ? undefined
          : instructions === null
            ? null
            : typeof instructions === "string"
              ? instructions.trim() || null
              : undefined,
    };
  })
  .handler(async ({ data }) => {
    await assertAdminToken(data.accessToken);
    const admin = getAdminClient();
    // Load the existing row so account_last_8 can be re-derived (and bad legacy
    // rows repaired) on any edit or toggle, using the stored immutable type.
    const { data: existing, error: loadError } = await admin
      .from("payment_methods")
      .select("id, type, account_number")
      .eq("id", data.methodId)
      .single();
    if (loadError || !existing)
      throwSafe("PAYMENT", "Payment method not found.", "No payment method for id: " + data.methodId);
    const nextAccountNumber =
      data.accountNumber !== undefined ? data.accountNumber : existing.account_number;
    const accountLast8 = deriveAccountLast8(existing.type as PaymentMethodType, nextAccountNumber);
    const update: {
      account_name?: string;
      account_number?: string;
      is_active?: boolean;
      instructions?: string | null;
      account_last_8?: string | null;
    } = { account_last_8: accountLast8 };
    if (data.accountName !== undefined) update.account_name = data.accountName;
    if (data.accountNumber !== undefined)
      update.account_number = data.accountNumber;
    if (data.isActive !== undefined) update.is_active = data.isActive;
    if (data.instructions !== undefined) update.instructions = data.instructions;
    const { data: row, error } = await admin
      .from("payment_methods")
      .update(update)
      .eq("id", data.methodId)
      .select()
      .single();
    if (error) throwSafe("PAYMENT", "Failed to update payment method.", `DB error: ${error.message}`);
    return row;
  });
