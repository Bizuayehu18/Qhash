import { createFileRoute } from "@tanstack/react-router";
import { DashboardPage } from "@/domains/accounts/public.js";

export const Route = createFileRoute("/_app/dashboard")({
  component: DashboardPage,
});
