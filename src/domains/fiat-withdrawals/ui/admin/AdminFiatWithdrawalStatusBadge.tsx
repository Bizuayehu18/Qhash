import { Badge } from "@/components/ui/Badge.js";
import { ADMIN_FIAT_WITHDRAWAL_STATUS } from "./admin-fiat-withdrawal-operations-presentation.js";

export function AdminFiatWithdrawalStatusBadge({
  status,
}: Readonly<{ status: string }>) {
  const presentation = ADMIN_FIAT_WITHDRAWAL_STATUS[status] ?? {
    label: status,
    variant: "default" as const,
  };

  return (
    <Badge variant={presentation.variant}>
      {presentation.label}
    </Badge>
  );
}
