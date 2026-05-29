import { getAdminClient } from "./supabase-admin.js";

interface ActiveInvestment {
  id: string;
  daily_earning: number;
  total_earned: number;
  start_date: string;
  end_date: string;
  last_earning_at: string | null;
}

export interface EarningResult {
  totalNewEarnings: number;
  processedInvestments: Array<{
    investmentId: string;
    daysElapsed: number;
    earnings: number;
  }>;
  earningTransactions: Array<{
    investmentId: string;
    amount: number;
    earningDate: string;
    earningDayIndex: number;
  }>;
}

export async function processEarnings(
  userId: string,
  activeInvs: ActiveInvestment[],
): Promise<EarningResult> {
  const admin = getAdminClient();
  const now = new Date();
  let totalNewEarnings = 0;
  const processedInvestments: EarningResult["processedInvestments"] = [];
  const earningTransactions: EarningResult["earningTransactions"] = [];

  for (const inv of activeInvs) {
    const lastEarning = new Date(inv.last_earning_at ?? inv.start_date);
    const endDate = new Date(inv.end_date);
    const effectiveNow = now > endDate ? endDate : now;

    const msElapsed = effectiveNow.getTime() - lastEarning.getTime();
    const daysElapsed = Math.floor(msElapsed / (24 * 60 * 60 * 1000));

    if (daysElapsed > 0) {
      const earnings = daysElapsed * inv.daily_earning;
      totalNewEarnings += earnings;

      const DAY_MS = 24 * 60 * 60 * 1000;
      const newLastEarningAt = new Date(
        lastEarning.getTime() + daysElapsed * DAY_MS,
      ).toISOString();

      for (let dayIdx = 1; dayIdx <= daysElapsed; dayIdx++) {
        const earningDate = new Date(
          lastEarning.getTime() + dayIdx * DAY_MS,
        )
          .toISOString()
          .slice(0, 10);

        await admin.from("transactions").insert({
          user_id: userId,
          type: "earning",
          amount: inv.daily_earning,
          status: "completed",
          description: "Daily mining earnings",
          reference_id: inv.id,
          metadata: {
            source: "client",
            investment_id: inv.id,
            earning_date: earningDate,
            earning_day_index: dayIdx,
          },
        });

        earningTransactions.push({
          investmentId: inv.id,
          amount: inv.daily_earning,
          earningDate,
          earningDayIndex: dayIdx,
        });
      }

      await admin
        .from("investments")
        .update({
          last_earning_at: newLastEarningAt,
          total_earned: inv.total_earned + earnings,
          ...(now >= endDate ? { status: "completed" as const } : {}),
        })
        .eq("id", inv.id);

      processedInvestments.push({ investmentId: inv.id, daysElapsed, earnings });
    } else if (now >= endDate) {
      await admin
        .from("investments")
        .update({ status: "completed" as const })
        .eq("id", inv.id);
    }
  }

  return { totalNewEarnings, processedInvestments, earningTransactions };
}

export async function creditWallet(
  userId: string,
  amount: number,
): Promise<void> {
  if (amount <= 0) return;

  const admin = getAdminClient();

  const { data: wallet } = await admin
    .from("wallets")
    .select("balance")
    .eq("user_id", userId)
    .single();

  const currentBalance = wallet?.balance ?? 0;

  if (wallet) {
    await admin
      .from("wallets")
      .update({
        balance: currentBalance + amount,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", userId);
  } else {
    await admin.from("wallets").insert({
      user_id: userId,
      balance: amount,
    });
  }
}
