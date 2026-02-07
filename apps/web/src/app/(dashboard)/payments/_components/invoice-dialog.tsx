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
import { useCreateInvoice } from "@/hooks/use-payments";

interface InvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: any;
}

export function InvoiceDialog({ open, onOpenChange, payment }: InvoiceDialogProps) {
  const [form, setForm] = useState({
    type: "boleta",
    customerName: "",
    customerDocType: "dni",
    customerDocNumber: "",
  });

  const createInvoice = useCreateInvoice();

  const handleCreate = async () => {
    if (!payment?.order_id || !form.customerName || !form.customerDocNumber) return;
    try {
      await createInvoice.mutateAsync({
        orderId: payment.order_id,
        type: form.type,
        customerName: form.customerName,
        customerDocType: form.customerDocType,
        customerDocNumber: form.customerDocNumber,
      });
      onOpenChange(false);
      setForm({
        type: "boleta",
        customerName: "",
        customerDocType: "dni",
        customerDocNumber: "",
      });
    } catch {}
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generar Comprobante</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="invoiceType">Tipo de Comprobante</Label>
            <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="boleta">Boleta</SelectItem>
                <SelectItem value="factura">Factura</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="customerName">Nombre del Cliente</Label>
            <Input
              id="customerName"
              placeholder="Nombre o razon social"
              value={form.customerName}
              onChange={(e) => setForm({ ...form, customerName: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="docType">Tipo de Documento</Label>
              <Select value={form.customerDocType} onValueChange={(v) => setForm({ ...form, customerDocType: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Tipo doc." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="dni">DNI</SelectItem>
                  <SelectItem value="ruc">RUC</SelectItem>
                  <SelectItem value="ce">CE</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="docNumber">Numero de Documento</Label>
              <Input
                id="docNumber"
                placeholder={
                  form.customerDocType === "dni"
                    ? "12345678"
                    : form.customerDocType === "ruc"
                    ? "20123456789"
                    : "AB1234567"
                }
                value={form.customerDocNumber}
                onChange={(e) =>
                  setForm({ ...form, customerDocNumber: e.target.value })
                }
              />
            </div>
          </div>
          {createInvoice.isError && (
            <p className="text-sm text-destructive">
              {(createInvoice.error as Error).message}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleCreate}
            disabled={
              createInvoice.isPending ||
              !form.customerName ||
              !form.customerDocNumber
            }
          >
            {createInvoice.isPending ? "Generando..." : "Generar Comprobante"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
