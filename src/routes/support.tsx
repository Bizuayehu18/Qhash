import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/support")({
  component: SupportRedirectPage,
});

function SupportRedirectPage() {
  return null;
}
