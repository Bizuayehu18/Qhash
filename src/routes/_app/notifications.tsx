import { createFileRoute } from "@tanstack/react-router";
import { NotificationsPage } from "@/domains/notifications/public.js";

export const Route = createFileRoute("/_app/notifications")({
  component: NotificationsPage,
});
