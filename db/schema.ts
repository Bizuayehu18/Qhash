import { pgTable, text, timestamp, doublePrecision, uuid, pgEnum, index, integer, unique, check, boolean } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const transactionTypeEnum = pgEnum("transaction_type", [
  "deposit",
  "withdrawal",
  "investment",
  "earning",
  "admin_adjustment",
]);

export const transactionStatusEnum = pgEnum("transaction_status", [
  "completed",
  "pending",
  "failed",
]);

export const investmentStatusEnum = pgEnum("investment_status", [
  "active",
  "completed",
  "cancelled",
]);

export const wallets = pgTable("wallets", {
  userId: text("user_id").primaryKey(),
  balance: doublePrecision("balance").default(0).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const transactions = pgTable("transactions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),
  type: transactionTypeEnum("type").notNull(),
  amount: doublePrecision("amount").notNull(),
  status: transactionStatusEnum("status").default("completed").notNull(),
  description: text("description"),
  referenceId: text("reference_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("transactions_user_id_idx").on(table.userId),
  index("transactions_user_type_idx").on(table.userId, table.type),
]);

export const investments = pgTable("investments", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),
  planId: text("plan_id").notNull(),
  investedAmount: doublePrecision("invested_amount").notNull(),
  dailyEarning: doublePrecision("daily_earning").notNull(),
  startDate: timestamp("start_date").defaultNow().notNull(),
  endDate: timestamp("end_date").notNull(),
  status: investmentStatusEnum("status").default("active").notNull(),
  lastEarningAt: timestamp("last_earning_at"),
  totalEarned: doublePrecision("total_earned").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("investments_user_id_idx").on(table.userId),
  index("investments_user_status_idx").on(table.userId, table.status),
]);

export const ticketStatusEnum = pgEnum("ticket_status", [
  "open",
  "in_progress",
  "resolved",
  "closed",
]);

export const supportTickets = pgTable("support_tickets", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),
  subject: text("subject").notNull(),
  message: text("message").notNull(),
  status: ticketStatusEnum("status").default("open").notNull(),
  adminReply: text("admin_reply"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
  index("support_tickets_user_id_idx").on(table.userId),
  index("support_tickets_status_idx").on(table.status),
]);

export const profiles = pgTable("profiles", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  phone: text("phone").notNull().unique(),
  referredBy: text("referred_by"),
  isAdmin: boolean("is_admin").default(false).notNull(),
  isFrozen: boolean("is_frozen").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const referrals = pgTable("referrals", {
  id: uuid("id").defaultRandom().primaryKey(),
  referrerId: text("referrer_id").notNull(),
  referredUserId: text("referred_user_id").notNull(),
  level: integer("level").notNull(),
  totalInvestmentRewards: doublePrecision("total_investment_rewards").default(0).notNull(),
  totalMiningRewards: doublePrecision("total_mining_rewards").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  unique("uq_referral_pair").on(table.referrerId, table.referredUserId),
  check("chk_no_self_refer", sql`${table.referrerId} <> ${table.referredUserId}`),
  check("chk_level_range", sql`${table.level} >= 1 AND ${table.level} <= 3`),
  index("idx_referrals_referrer_id").on(table.referrerId),
  index("idx_referrals_referred_user_id").on(table.referredUserId),
  index("idx_referrals_referred_user_level").on(table.referredUserId, table.level),
]);
