import { createFileRoute } from "@tanstack/react-router";
import { TransactionsPage } from "@/domains/accounts/public.js";

export const Route = createFileRoute("/_app/transactions")({
  component: TransactionsPage,
});
