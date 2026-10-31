"use client";

import { useState } from "react";
import { EllipsisVertical, MapPin, Phone, Plus, UserRound } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import AddressFormDialog from "./AddressFormDialog";
import {
  deleteBillingAddress,
  updateBillingAddress,
  type BillingAddress,
} from "@/actions/billing-addresses";

/**
 * The saved-address picker: one radio card per address, a kebab for edit /
 * default / delete, and Cancel / Apply. Add and Edit live in a second dialog
 * stacked on top of this one.
 *
 * The list only exists while the dialog is open and is keyed by the incoming
 * selection, so reopening always starts from the caller's current choice.
 */
export default function BillingAddressDialog({
  open,
  onOpenChange,
  addresses,
  selectedId,
  defaultName,
  defaultPhone,
  onApply,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  addresses: BillingAddress[];
  selectedId: string | null;
  defaultName: string;
  defaultPhone: string;
  onApply: (id: string) => void;
  onChanged: () => void;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<BillingAddress | null>(null);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader className="flex-row items-center justify-between">
            <DialogTitle className="text-center">Billing Address</DialogTitle>
            <Button
              className="h-9 rounded-full bg-orange-500 px-4 text-sm font-medium text-white hover:bg-orange-600"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus className="mr-1 h-4 w-4" /> Add Address
            </Button>
          </DialogHeader>

          {open && (
            <AddressPicker
              key={selectedId ?? "none"}
              addresses={addresses}
              selectedId={selectedId}
              onEdit={(address) => {
                setEditing(address);
                setFormOpen(true);
              }}
              onChanged={onChanged}
              onApply={(id) => {
                onApply(id);
                onOpenChange(false);
              }}
              onCancel={() => onOpenChange(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      <AddressFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        defaultName={defaultName}
        defaultPhone={defaultPhone}
        onSaved={onChanged}
      />
    </>
  );
}

function AddressPicker({
  addresses,
  selectedId,
  onEdit,
  onChanged,
  onApply,
  onCancel,
}: {
  addresses: BillingAddress[];
  selectedId: string | null;
  onEdit: (address: BillingAddress) => void;
  onChanged: () => void;
  onApply: (id: string) => void;
  onCancel: () => void;
}) {
  const [picked, setPicked] = useState<string | null>(
    selectedId ?? addresses.find((a) => a.isDefault)?.id ?? null,
  );

  async function setDefault(address: BillingAddress) {
    const result = await updateBillingAddress(address.id, { isDefault: true });
    if (!result.success) {
      toast.error(result.error ?? "Could not update the address");
      return;
    }
    onChanged();
  }

  async function remove(address: BillingAddress) {
    const result = await deleteBillingAddress(address.id);
    if (!result.success) {
      toast.error(result.error ?? "Could not delete the address");
      return;
    }
    if (picked === address.id) setPicked(null);
    onChanged();
  }

  return (
    <>
      <div className="min-h-[280px] space-y-3">
        {addresses.length === 0 ? (
          <p className="py-12 text-center text-sm text-gray-500">
            No saved addresses yet. Add one to use it at checkout.
          </p>
        ) : (
          addresses.map((address) => {
            const selected = address.id === picked;
            return (
              <div
                key={address.id}
                onClick={() => setPicked(address.id)}
                className={`flex cursor-pointer items-start gap-3 rounded-sm border p-4 transition-colors ${
                  selected
                    ? "border-[#00a0e9] bg-[#00a0e9]/5"
                    : "hover:bg-muted"
                }`}
              >
                <span
                  aria-hidden
                  className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                    selected ? "border-[#00a0e9]" : "border-gray-300"
                  }`}
                >
                  {selected && (
                    <span className="h-2.5 w-2.5 rounded-full bg-[#00a0e9]" />
                  )}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-lg font-semibold">{address.label}</h3>
                    {address.isDefault && (
                      <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-semibold text-white">
                        Default
                      </span>
                    )}
                  </div>
                  <div className="mt-2 space-y-1 text-sm text-foreground">
                    <p className="flex items-center gap-2">
                      <UserRound className="h-4 w-4 shrink-0 text-gray-400" />
                      {address.name}
                    </p>
                    <p className="flex items-center gap-2">
                      <Phone className="h-4 w-4 shrink-0 text-gray-400" />
                      {address.phone}
                    </p>
                    <p className="flex items-start gap-2">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                      <span>
                        {address.address}
                        {address.company && (
                          <span className="block text-gray-500">
                            {address.company}
                          </span>
                        )}
                      </span>
                    </p>
                  </div>
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="Address actions"
                      onClick={(e) => e.stopPropagation()}
                      className="rounded-sm p-1 text-gray-500 hover:bg-muted"
                    >
                      <EllipsisVertical className="h-5 w-5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        onEdit(address);
                      }}
                    >
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={address.isDefault}
                      onClick={(e) => {
                        e.stopPropagation();
                        void setDefault(address);
                      }}
                    >
                      Set as default
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        void remove(address);
                      }}
                    >
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })
        )}
      </div>

      <div className="flex gap-2 border-t pt-3">
        <Button
          variant="outline"
          className="h-10 w-1/2 rounded-sm"
          onClick={onCancel}
        >
          Cancel
        </Button>
        <Button
          className="h-10 w-1/2 rounded-sm bg-orange-500 text-white hover:bg-orange-600"
          disabled={!picked}
          onClick={() => {
            if (picked) onApply(picked);
          }}
        >
          Apply
        </Button>
      </div>
    </>
  );
}
