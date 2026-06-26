import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { PageLoader } from "@/components/ui/Spinner.js";

export const Route = createFileRoute("/_app/security")({
  component: LegacySecurityRedirect,
});

function LegacySecurityRedirect() {
  const navigate = useNavigate();

  useEffect(() => {
    navigate({ to: "/profile/security", replace: true });
  }, [navigate]);

  return <PageLoader />;
}
