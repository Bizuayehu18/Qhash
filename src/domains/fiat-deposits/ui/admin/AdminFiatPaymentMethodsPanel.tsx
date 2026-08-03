import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button.js";
import { AdminPaymentMethodEditor } from "./AdminPaymentMethodEditor.js";
import { AdminPaymentMethodList } from "./AdminPaymentMethodList.js";
import { ADMIN_PAYMENT_METHOD_ARCHIVE_FILTERS } from "./admin-payment-methods-presentation.js";
import { useAdminPaymentMethods } from "./useAdminPaymentMethods.js";

type AdminFiatPaymentMethodsPanelProps = Readonly<{
  accessToken: string | null | undefined;
  userId: string | null | undefined;
}>;

export function AdminFiatPaymentMethodsPanel({
  accessToken,
  userId,
}: AdminFiatPaymentMethodsPanelProps) {
  const controller = useAdminPaymentMethods(userId, accessToken);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-gray-500">Manage deposit accounts</p>
        <Button
          size="sm"
          onClick={() => controller.setShowAdd(!controller.showAdd)}
        >
          <Plus size={13} /> Add
        </Button>
      </div>

      <div className="flex gap-2 overflow-x-auto hide-scrollbar -mx-4 px-4 pb-1">
        {ADMIN_PAYMENT_METHOD_ARCHIVE_FILTERS.map((filter) => (
          <button
            key={filter.key}
            onClick={() => controller.setArchiveFilter(filter.key)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-[11px] border transition-colors card-press ${
              controller.archiveFilter === filter.key
                ? "bg-[rgba(0,255,65,0.08)] text-[#00ff41] border-[rgba(0,255,65,0.3)]"
                : "text-gray-500 border-[#1f1f1f]"
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <AdminPaymentMethodEditor {...controller} />
      <AdminPaymentMethodList {...controller} />
    </div>
  );
}
