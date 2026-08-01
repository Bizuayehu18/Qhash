import { createFileRoute } from "@tanstack/react-router";
import { ReferralsPage } from "@/domains/referrals/public.js";

export const Route = createFileRoute("/_app/referrals")({
  component: ReferralsPage,
});
