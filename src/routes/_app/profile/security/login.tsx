import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/profile/security/login")({
  component: LoginSecurityPage,
});

function LoginSecurityPage() {
  return <div>Login Security</div>;
}
