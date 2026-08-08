"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@restai/ui/components/dialog";
import { Button } from "@restai/ui/components/button";
import { Input } from "@restai/ui/components/input";
import { Label } from "@restai/ui/components/label";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { useSeatCustomer, type TableRow } from "@/hooks/use-tables";

interface SeatCustomerDialogProps {
  table: TableRow | null;
  onClose: () => void;
}

/**
 * "Sentar cliente": abre la cuenta de la mesa desde el panel.
 *
 * Antes, "Ocupar" solo pintaba la mesa de azul. No nacía ninguna sesión, así
 * que no había cuenta a la que colgar pedidos ni cobros, y el QR de esa mesa
 * seguía libre para cualquiera que pasara. Este es además el camino del
 * comensal que no puede o no quiere escanear.
 */
export function SeatCustomerDialog({ table, onClose }: SeatCustomerDialogProps) {
  const seatCustomer = useSeatCustomer();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [guests, setGuests] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (table) {
      setName("");
      setPhone("");
      setGuests("");
      setError(null);
    }
  }, [table]);

  if (!table) return null;

  const trimmedName = name.trim();
  // Se acepta vacío: en hora punta nadie va a contar cabezas antes de abrir la
  // cuenta. Un valor fuera de rango se descarta en vez de bloquear el alta.
  const comensalesRaw = Number.parseInt(guests, 10);
  const comensales =
    Number.isFinite(comensalesRaw) && comensalesRaw > 0 && comensalesRaw <= 200
      ? comensalesRaw
      : null;

  const submit = async () => {
    if (!trimmedName) {
      setError("Escribe un nombre para identificar la mesa.");
      return;
    }
    setError(null);
    try {
      await seatCustomer.mutateAsync({
        tableId: table.id,
        customerName: trimmedName,
        customerPhone: phone.trim() || undefined,
        guests: comensales ?? undefined,
      });
      toast.success(`Mesa ${table.number} abierta a nombre de ${trimmedName}`);
      onClose();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "No se pudo abrir la cuenta de la mesa";
      setError(message);
      toast.error(message);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" aria-hidden="true" />
            Sentar cliente en la mesa {table.number}
          </DialogTitle>
          <DialogDescription>
            Se abre la cuenta de la mesa. A partir de aquí puedes tomarle pedidos y
            cobrarle desde el panel.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="seat-name">Nombre del cliente</Label>
            <Input
              id="seat-name"
              className="h-10"
              autoFocus
              maxLength={255}
              placeholder="Ej.: Familia Quispe"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Es el nombre con el que verás la mesa en cocina, pedidos y cobros.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="seat-guests">Comensales (opcional)</Label>
            <Input
              id="seat-guests"
              className="h-10"
              inputMode="numeric"
              min={1}
              max={200}
              type="number"
              placeholder={String(table.capacity)}
              value={guests}
              onChange={(e) => setGuests(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Cuántas personas se sientan de verdad. Es lo que hace que la sala
              muestre el aforo real y no el número de sillas.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="seat-phone">Teléfono (opcional)</Label>
            <Input
              id="seat-phone"
              className="h-10"
              inputMode="tel"
              maxLength={20}
              placeholder="999 999 999"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>

          {table.short_code && (
            <p className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
              Si el cliente quiere pedir desde su móvil, puede escanear el QR de la mesa
              o escribir el código{" "}
              <span className="font-bold tracking-widest text-foreground">
                {table.short_code}
              </span>
              .
            </p>
          )}

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              className="h-10 w-full sm:w-auto"
              onClick={onClose}
              disabled={seatCustomer.isPending}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              className="h-10 w-full sm:w-auto"
              disabled={seatCustomer.isPending || !trimmedName}
            >
              {seatCustomer.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
              )}
              Abrir cuenta
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
