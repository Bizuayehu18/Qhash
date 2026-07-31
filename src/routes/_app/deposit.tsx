import { createFileRoute } from "@tanstack/react-router";
import { DepositHub } from "@/domains/deposits/public.js";

export const Route = createFileRoute("/_app/deposit")({
  component: DepositHub,
});
