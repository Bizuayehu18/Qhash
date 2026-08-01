import { createFileRoute } from "@tanstack/react-router";
import { SupportRedirectPage } from "@/domains/support/public.js";

export const Route = createFileRoute("/support")({
  component: SupportRedirectPage,
});
