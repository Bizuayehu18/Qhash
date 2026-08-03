import { Building2, Smartphone } from "lucide-react";
import { Button } from "@/components/ui/Button.js";
import { Input } from "@/components/ui/Input.js";
import {
  ADMIN_PAYMENT_METHOD_LABELS,
  ADMIN_PAYMENT_METHOD_TYPES,
} from "./admin-payment-methods-presentation.js";
import type { useAdminPaymentMethods } from "./useAdminPaymentMethods.js";

type AdminPaymentMethodsController = ReturnType<typeof useAdminPaymentMethods>;

type AdminPaymentMethodEditorProps = Pick<
  AdminPaymentMethodsController,
  | "addMethod"
  | "cancelEdit"
  | "editInstructions"
  | "editName"
  | "editNumber"
  | "editSaving"
  | "editingMethod"
  | "newInstructions"
  | "newName"
  | "newNumber"
  | "newType"
  | "saveEdit"
  | "saving"
  | "setEditInstructions"
  | "setEditName"
  | "setEditNumber"
  | "setNewInstructions"
  | "setNewName"
  | "setNewNumber"
  | "setNewType"
  | "setShowAdd"
  | "showAdd"
>;

export function AdminPaymentMethodEditor(
  props: AdminPaymentMethodEditorProps,
) {
  return (
    <>
      {props.showAdd && (
        <div className="bg-[#111] rounded-xl border border-[rgba(0,255,65,0.15)] p-4 space-y-3">
          <span className="text-xs font-semibold">New Payment Account</span>
          <div className="flex gap-2">
            {ADMIN_PAYMENT_METHOD_TYPES.map((type) => (
              <button
                key={type}
                onClick={() => props.setNewType(type)}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs border transition-all card-press ${
                  props.newType === type
                    ? "border-[rgba(0,255,65,0.4)] bg-[rgba(0,255,65,0.08)] text-[#00ff41]"
                    : "border-[#1f1f1f] text-gray-400"
                }`}
              >
                {type === "cbe"
                  ? <Building2 size={13} />
                  : <Smartphone size={13} />}
                {ADMIN_PAYMENT_METHOD_LABELS[type]}
              </button>
            ))}
          </div>
          <Input
            label="Account Name"
            placeholder="e.g. QHash Trading PLC"
            value={props.newName}
            onChange={(event) => props.setNewName(event.target.value)}
          />
          <Input
            label="Account Number"
            placeholder="e.g. 1000123456789"
            value={props.newNumber}
            onChange={(event) => props.setNewNumber(event.target.value)}
          />
          {props.newType === "cbe" && (
            <p className="text-[10px] text-gray-500 -mt-1">
              Last 8 digits are generated automatically from the CBE account number.
            </p>
          )}
          <Input
            label="Instructions (optional)"
            placeholder="e.g. Use username as remark"
            value={props.newInstructions}
            onChange={(event) => props.setNewInstructions(event.target.value)}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              loading={props.saving}
              disabled={!props.newName.trim() || !props.newNumber.trim()}
              onClick={() => void props.addMethod()}
            >
              Create
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => props.setShowAdd(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {props.editingMethod && (
        <div className="bg-[#111] rounded-xl border border-[rgba(0,255,65,0.15)] p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold">
              Edit {ADMIN_PAYMENT_METHOD_LABELS[props.editingMethod.type]} Account
            </span>
            <button
              onClick={props.cancelEdit}
              className="text-[10px] text-gray-500"
            >
              Cancel
            </button>
          </div>
          <Input
            label="Account Name"
            value={props.editName}
            onChange={(event) => props.setEditName(event.target.value)}
          />
          <Input
            label="Account Number"
            value={props.editNumber}
            onChange={(event) => props.setEditNumber(event.target.value)}
          />
          {props.editingMethod.type === "cbe" && (
            <p className="text-[10px] text-gray-500 -mt-1">
              Last 8 digits are generated automatically from the CBE account number.
            </p>
          )}
          <Input
            label="Instructions (optional)"
            value={props.editInstructions}
            onChange={(event) => props.setEditInstructions(event.target.value)}
          />
          <Button
            size="sm"
            loading={props.editSaving}
            disabled={!props.editName.trim() || !props.editNumber.trim()}
            onClick={() => void props.saveEdit()}
          >
            Save Changes
          </Button>
        </div>
      )}
    </>
  );
}
