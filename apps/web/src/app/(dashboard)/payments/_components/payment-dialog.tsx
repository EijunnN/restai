"use client";

import { useState } from "react";
import { Input } from "@restai/ui/components/input";
import { Label } from "@restai/ui/components/label";
import { Button } from "@restai/ui/components/button";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@restai/ui/components/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@restai/ui/components/dialog";
import { useCreatePayment } from "@/hooks/use-payments";

interface PaymentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PaymentDialog({ open, onOpenChange }: PaymentDialogProps) {
  const [form, setForm] = useState({
    orderId: "",
    method: "cash",
    amount: "",
    reference: "",
    tip: "",
  });

  const createPayment = useCreatePayment();

  const handleCreate = async () => {
    if (!form.orderId || !form.amount) return;
    try {
      await createPayment.mutateAsync({
        orderId: form.orderId,
        method: form.method,
        amount: Math.round(parseFloat(form.amount) * 100),
        reference: form.reference || undefined,
        tip: form.tip ? Math.round(parseFloat(form.tip) * 100) : 0,
      });
      onOpenChange(false);
      setForm({ orderId: "", method: "cash", amount: "", reference: "", tip: "" });
    } catch {}
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar Pago</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="orderId">ID de Orden</Label>
            <Input
              id="orderId"
              placeholder="UUID de la orden"
              value={form.orderId}
              onChange={(e) => setForm({ ...form, orderId: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="method">Metodo de Pago</Label>
            <Select value={form.method} onValueChange={(v) => setForm({ ...form, method: v })}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar metodo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Efectivo</SelectItem>
                <SelectItem value="card">Tarjeta</SelectItem>
                <SelectItem value="yape">Yape</SelectItem>
                <SelectItem value="plin">Plin</SelectItem>
                <SelectItem value="transfer">Transferencia</SelectItem>
                <SelectItem value="other">Otro</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="amount">Monto (S/)</Label>
              <Input
                id="amount"
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0.00"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tip">Propina (S/)</Label>
              <Input
                id="tip"
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                value={form.tip}
                onChange={(e) => setForm({ ...form, tip: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="reference">Referencia</Label>
            <Input
              id="reference"
              placeholder="Numero de operacion, etc."
              value={form.reference}
              onChange={(e) => setForm({ ...form, reference: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleCreate}
            disabled={createPayment.isPending || !form.orderId || !form.amount}
          >
            {createPayment.isPending ? "Registrando..." : "Registrar Pago"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
