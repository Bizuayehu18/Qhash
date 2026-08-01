import { createFileRoute } from "@tanstack/react-router";
import { PlansPage } from "@/domains/plans/public.js";

export const Route = createFileRoute("/_app/plans")({
  component: PlansPage,
});
