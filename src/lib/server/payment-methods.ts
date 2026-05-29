import { createServerFn } from "@tanstack/react-start";
import { getAdminClient } from "./supabase-admin.js";
import type { PaymentMethodType } from "../database.types.js";
import { throwSafe } from "../errors.js";

async function assertAdmin(userId: string) {
  const admin = getAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("is_admin")
    .eq("id", userId)
    .single();
  if (!profile?.is_admin) throwSafe("ADMIN", "Unauthorized.", "Non-admin user: " + userId);
}

export const getPaymentMethodsFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => {
    if (!data || typeof data !== "object") throwSafe("PAYMENT", "Failed to load payment methods.", "Invalid request data");
    const { activeOnly } = data as Record<string, unknown>;
    return { activeOnly: activeOnly !== false };
  })
  .handler(async ({ data }) => {
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
    const { userId, type, accountName, accountNumber, instructions } =
      data as Record<string, unknown>;
    if (typeof userId !== "string" || !userId) throwSafe("PAYMENT", "Failed to create payment method.", "Missing user ID");
    if (type !== "cbe" && type !== "telebirr")
      throwSafe("PAYMENT", "Invalid payment method type.", "Invalid type: " + String(type));
    if (typeof accountName !== "string" || !accountName.trim())
      throwSafe("PAYMENT", "Account name is required.", "Missing account name");
    if (typeof accountNumber !== "string" || !accountNumber.trim())
      throwSafe("PAYMENT", "Account number is required.", "Missing account number");
    const { accountLast8 } = data as Record<string, unknown>;
    return {
      userId,
      type: type as PaymentMethodType,
      accountName: accountName.trim(),
      accountNumber: accountNumber.trim(),
      instructions:
        typeof instructions === "string" && instructions.trim()
          ? instructions.trim()
          : null,
      accountLast8:
        typeof accountLast8 === "string" && accountLast8.trim()
          ? accountLast8.trim()
          : null,
    };
  })
  .handler(async ({ data }) => {
    await assertAdmin(data.userId);
    const admin = getAdminClient();
    const { data: row, error } = await admin
      .from("payment_methods")
      .insert({
        type: data.type,
        account_name: data.accountName,
        account_number: data.accountNumber,
        instructions: data.instructions,
        account_last_8: data.accountLast8,
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
    const { userId, methodId, accountName, accountNumber, isActive, instructions, accountLast8 } =
      data as Record<string, unknown>;
    if (typeof userId !== "string" || !userId) throwSafe("PAYMENT", "Failed to update payment method.", "Missing user ID");
    if (typeof methodId !== "string" || !methodId)
      throwSafe("PAYMENT", "Failed to update payment method.", "Missing method ID");
    return {
      userId,
      methodId,
      accountName:
        typeof accountName === "string" ? accountName.trim() : undefined,
      accountNumber:
        typeof accountNumber === "string" ? accountNumber.trim() : undefined,
      isActive: typeof isActive === "boolean" ? isActive : undefined,
      instructions:
        typeof instructions === "string" ? instructions.trim() || null : undefined,
      accountLast8:
        typeof accountLast8 === "string" ? accountLast8.trim() || null : undefined,
    };
  })
  .handler(async ({ data }) => {
    await assertAdmin(data.userId);
    const admin = getAdminClient();
    const update: {
      account_name?: string;
      account_number?: string;
      is_active?: boolean;
      instructions?: string | null;
      account_last_8?: string | null;
    } = {};
    if (data.accountName !== undefined) update.account_name = data.accountName;
    if (data.accountNumber !== undefined)
      update.account_number = data.accountNumber;
    if (data.isActive !== undefined) update.is_active = data.isActive;
    if (data.instructions !== undefined) update.instructions = data.instructions;
    if (data.accountLast8 !== undefined) update.account_last_8 = data.accountLast8;
    if (Object.keys(update).length === 0)
      throwSafe("PAYMENT", "No fields to update.", "Empty update payload");
    const { data: row, error } = await admin
      .from("payment_methods")
      .update(update)
      .eq("id", data.methodId)
      .select()
      .single();
    if (error) throwSafe("PAYMENT", "Failed to update payment method.", `DB error: ${error.message}`);
    return row;
  });
