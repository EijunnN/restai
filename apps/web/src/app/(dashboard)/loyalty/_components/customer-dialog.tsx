"use client";

import { useEffect, useState } from "react";
import { Input } from "@restai/ui/components/input";
import { Label } from "@restai/ui/components/label";
import { DatePicker } from "@restai/ui/components/date-picker";
import { Button } from "@restai/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@restai/ui/components/dialog";
import { Check, ShieldCheck } from "lucide-react";
import { useCreateCustomer, useUpdateCustomer } from "@/hooks/use-loyalty";
import { formatDate } from "@/lib/utils";
import { toast } from "sonner";

interface CustomerForm {
  name: string;
  phone: string;
  email: string;
  birthDate: string;
  marketingOptIn: boolean;
}

const emptyForm: CustomerForm = {
  name: "",
  phone: "",
  email: "",
  birthDate: "",
  marketingOptIn: false,
};

/**
 * Dialog to create OR edit a customer.
 * When `editData` is provided, the dialog runs in edit mode (PATCH via
 * useUpdateCustomer); otherwise it creates (POST via useCreateCustomer).
 */
export function CustomerDialog({
  open,
  onOpenChange,
  editData,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editData?: any;
}) {
  const createCustomer = useCreateCustomer();
  const updateCustomer = useUpdateCustomer();
  const isEdit = !!editData;

  const [form, setForm] = useState<CustomerForm>(emptyForm);

  // Hydrate the form whenever the dialog opens (or the target customer changes).
  useEffect(() => {
    if (!open) return;
    if (editData) {
      setForm({
        name: editData.name ?? "",
        phone: editData.phone ?? "",
        email: editData.email ?? "",
        birthDate: editData.birth_date ?? "",
        marketingOptIn: !!editData.marketing_opt_in,
      });
    } else {
      setForm(emptyForm);
    }
  }, [open, editData]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      name: form.name,
      phone: form.phone || undefined,
      email: form.email || undefined,
      birthDate: form.birthDate || undefined,
      marketingOptIn: form.marketingOptIn,
    };

    if (isEdit) {
      updateCustomer.mutate(
        { id: editData.id, ...payload },
        {
          onSuccess: () => {
            onOpenChange(false);
            toast.success("Cliente actualizado");
          },
          onError: (err) => toast.error(`Error: ${(err as Error).message}`),
        },
      );
    } else {
      createCustomer.mutate(payload, {
        onSuccess: () => {
          setForm(emptyForm);
          onOpenChange(false);
          toast.success("Cliente registrado exitosamente");
        },
        onError: (err) => toast.error(`Error: ${(err as Error).message}`),
      });
    }
  }

  const isPending = createCustomer.isPending || updateCustomer.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar Cliente" : "Registrar Cliente"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cust-name">Nombre *</Label>
            <Input id="cust-name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cust-phone">Teléfono</Label>
            <Input id="cust-phone" value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cust-email">Email</Label>
            <Input id="cust-email" type="email" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cust-birth">Fecha de nacimiento</Label>
            <DatePicker id="cust-birth" value={form.birthDate} onChange={(d) => setForm((p) => ({ ...p, birthDate: d ?? "" }))} />
          </div>

          {/* Marketing consent toggle */}
          <div className="rounded-lg border border-border p-3 space-y-2">
            <button
              type="button"
              role="switch"
              aria-checked={form.marketingOptIn}
              onClick={() => setForm((p) => ({ ...p, marketingOptIn: !p.marketingOptIn }))}
              className="flex w-full items-center justify-between gap-3 text-left"
            >
              <div className="flex items-start gap-2">
                <ShieldCheck className="h-4 w-4 mt-0.5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium text-foreground">Acepta marketing</p>
                  <p className="text-xs text-muted-foreground">
                    El cliente consiente recibir correos de puntos, recompensas y promociones.
                  </p>
                </div>
              </div>
              <span
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                  form.marketingOptIn ? "bg-primary" : "bg-muted"
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-background shadow transition-transform ${
                    form.marketingOptIn ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
              </span>
            </button>
            {isEdit && editData?.consent_at && (
              <p className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                <Check className="h-3 w-3" />
                Consentimiento registrado el {formatDate(editData.consent_at)}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={isPending || !form.name}>
              {isPending ? "Guardando..." : isEdit ? "Guardar Cambios" : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Backwards-compatible alias. Existing callers import `CreateCustomerDialog`;
 * it now simply renders the unified dialog in create mode.
 */
export function CreateCustomerDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return <CustomerDialog {...props} />;
}
