import {
  Archive,
  ArchiveRestore,
  Building2,
  Pencil,
  Power,
  Smartphone,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge.js";
import { Spinner } from "@/components/ui/Spinner.js";
import { ADMIN_PAYMENT_METHOD_LABELS } from "./admin-payment-methods-presentation.js";
import type { useAdminPaymentMethods } from "./useAdminPaymentMethods.js";

type AdminPaymentMethodsController = ReturnType<typeof useAdminPaymentMethods>;

type AdminPaymentMethodListProps = Pick<
  AdminPaymentMethodsController,
  | "archiveFilter"
  | "archivingId"
  | "methods"
  | "methodsLoaded"
  | "setArchived"
  | "startEdit"
  | "toggleActive"
  | "togglingId"
>;

export function AdminPaymentMethodList(props: AdminPaymentMethodListProps) {
  if (!props.methodsLoaded) {
    return (
      <div className="space-y-2">
        {[1, 2].map((item) => (
          <div key={item} className="skeleton h-16 rounded-xl" />
        ))}
      </div>
    );
  }

  if (props.methods.length === 0) {
    return (
      <div className="bg-[#111] rounded-xl border border-[#1a1a1a] p-8 text-center text-xs text-gray-600">
        {props.archiveFilter === "archived"
          ? "No archived payment methods."
          : "No payment methods configured."}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {props.methods.map((method) => (
        <div
          key={method.id}
          className={`flex items-center gap-3 bg-[#111] rounded-xl border p-3 ${
            method.is_archived
              ? "border-[#1a1a1a] opacity-50"
              : method.is_active
                ? "border-[#1a1a1a]"
                : "border-[#1a1a1a] opacity-70"
          }`}
        >
          <span className="text-gray-500">
            {method.type === "cbe"
              ? <Building2 size={16} />
              : <Smartphone size={16} />}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-gray-200 truncate">
                {method.account_name}
              </span>
              {method.is_archived ? (
                <Badge variant="default">Archived</Badge>
              ) : (
                <Badge variant={method.is_active ? "neon" : "default"}>
                  {method.is_active ? "Active" : "Off"}
                </Badge>
              )}
            </div>
            <p className="text-[10px] text-gray-500 font-mono mt-0.5">
              {ADMIN_PAYMENT_METHOD_LABELS[method.type]} — {method.account_number}
            </p>
          </div>
          {!method.is_archived && (
            <>
              <button
                onClick={() => props.startEdit(method)}
                className="p-2 rounded-lg text-gray-600 hover:text-gray-300 transition-colors card-press"
              >
                <Pencil size={13} />
              </button>
              <button
                onClick={() => void props.toggleActive(method)}
                disabled={props.togglingId === method.id}
                className={`p-2 rounded-lg transition-colors card-press ${
                  method.is_active
                    ? "text-gray-500 hover:text-red-400"
                    : "text-gray-600 hover:text-[#00ff41]"
                }`}
                title={method.is_active ? "Disable" : "Enable"}
              >
                {props.togglingId === method.id
                  ? <Spinner size="sm" />
                  : <Power size={14} />}
              </button>
            </>
          )}
          <button
            onClick={() => void props.setArchived(
              method,
              !method.is_archived,
            )}
            disabled={props.archivingId === method.id}
            className={`p-2 rounded-lg transition-colors card-press ${
              method.is_archived
                ? "text-gray-600 hover:text-[#00ff41]"
                : "text-gray-500 hover:text-red-400"
            }`}
            title={method.is_archived ? "Restore" : "Archive"}
          >
            {props.archivingId === method.id ? (
              <Spinner size="sm" />
            ) : method.is_archived ? (
              <ArchiveRestore size={14} />
            ) : (
              <Archive size={14} />
            )}
          </button>
        </div>
      ))}
    </div>
  );
}
