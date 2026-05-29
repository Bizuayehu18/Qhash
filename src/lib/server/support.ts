import { createServerFn } from "@tanstack/react-start";
import { db } from "../../../db/index.js";
import { supportTickets } from "../../../db/schema.js";
import { eq, desc } from "drizzle-orm";
import { throwSafe } from "../errors.js";

function validateSubmitInput(data: unknown): {
  userId: string;
  subject: string;
  message: string;
} {
  if (!data || typeof data !== "object") throwSafe("SUPPORT", "Unable to submit ticket. Please try again.", "Invalid request data");
  const { userId, subject, message } = data as Record<string, unknown>;
  if (typeof userId !== "string" || userId.length === 0)
    throwSafe("SUPPORT", "Unable to submit ticket. Please try again.", "Missing user ID");
  if (typeof subject !== "string" || subject.trim().length === 0)
    throwSafe("SUPPORT", "Subject is required.", "Missing subject");
  if (subject.trim().length > 200)
    throwSafe("SUPPORT", "Subject must be under 200 characters.", "Subject too long: " + subject.trim().length);
  if (typeof message !== "string" || message.trim().length === 0)
    throwSafe("SUPPORT", "Message is required.", "Missing message");
  if (message.trim().length > 5000)
    throwSafe("SUPPORT", "Message must be under 5,000 characters.", "Message too long: " + message.trim().length);
  return { userId, subject: subject.trim(), message: message.trim() };
}

function validateUserId(data: unknown): { userId: string } {
  if (!data || typeof data !== "object") throwSafe("SUPPORT", "Unable to load tickets.", "Invalid request data");
  const { userId } = data as Record<string, unknown>;
  if (typeof userId !== "string" || userId.length === 0)
    throwSafe("SUPPORT", "Unable to load tickets.", "Missing user ID");
  return { userId };
}

export const submitTicketFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => validateSubmitInput(data))
  .handler(async ({ data }) => {
    const { userId, subject, message } = data;

    try {
      const [ticket] = await db
        .insert(supportTickets)
        .values({ userId, subject, message })
        .returning();

      return { ticket };
    } catch (err) {
      console.error("[QHash] Submit ticket error:", err);
      throwSafe("SUPPORT", "Failed to submit ticket. Please try again.", `DB error: ${err instanceof Error ? err.message : String(err)}`);
    }
  });

export const getTicketsFn = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => validateUserId(data))
  .handler(async ({ data }) => {
    const { userId } = data;

    try {
      const tickets = await db
        .select()
        .from(supportTickets)
        .where(eq(supportTickets.userId, userId))
        .orderBy(desc(supportTickets.createdAt))
        .limit(20);

      return tickets;
    } catch (err) {
      console.error("[QHash] Get tickets error:", err);
      throwSafe("SUPPORT", "Failed to load tickets.", `DB error: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
