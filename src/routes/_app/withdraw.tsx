import { createFileRoute } from "@tanstack/react-router";
import { WithdrawalHub } from "@/domains/withdrawals/public.js";

export const Route = createFileRoute("/_app/withdraw")({
  component: WithdrawalHub,
});
