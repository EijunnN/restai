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
import { Printer } from "lucide-react";
import { useOrgSettings, useBranchSettings } from "@/hooks/use-settings";
import { usePrintReceipt } from "@/components/print-ticket";
import { apiFetch } from "@/lib/fetcher";

interface ReceiptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: any;
}

export function ReceiptDialog({ open, onOpenChange, payment }: ReceiptDialogProps) {
  const [docType, setDocType] = useState<"boleta_simple" | "boleta_electronica" | "factura">("boleta_simple");
  const [docNumber, setDocNumber] = useState("");
  const [docHolderName, setDocHolderName] = useState("");
  const [printing, setPrinting] = useState(false);

  const { data: orgSettings } = useOrgSettings();
  const { data: branchSettings } = useBranchSettings();
  const printReceipt = usePrintReceipt();

  const isFormValid = () => {
    if (docType === "boleta_simple") return true;
    if (docType === "boleta_electronica") return /^\d{8}$/.test(docNumber);
    if (docType === "factura") return /^\d{11}$/.test(docNumber) && docHolderName.trim().length > 0;
    return false;
  };

  const handleDocTypeChange = (v: string) => {
    setDocType(v as "boleta_simple" | "boleta_electronica" | "factura");
    setDocNumber("");
    setDocHolderName("");
  };

  const handlePrint = async () => {
    if (!payment || !isFormValid()) return;
    setPrinting(true);
    try {
      const orderDetail = await apiFetch(`/api/orders/${payment.order_id}`);
      const org = orgSettings as any;
      const branch = branchSettings as any;
      const orderData = orderDetail as any;
      const items = orderData?.items || [];
      printReceipt({
        businessName: org?.name || "Restaurante",
        ruc: org?.settings?.ruc || undefined,
        address: branch?.address || undefined,
        orderNumber: payment.order_number || orderData?.order_number || "",
        createdAt: payment.created_at || new Date().toISOString(),
        items: items.map((i: any) => ({
          name: i.name,
          quantity: i.quantity,
          unit_price: i.unit_price,
          total: i.total,
        })),
        subtotal: orderData?.subtotal ?? 0,
        tax: orderData?.tax ?? 0,
        total: orderData?.total ?? 0,
        paymentMethod: payment.method,
        customerName: orderData?.customer_name || undefined,
        docType,
        docNumber: docType !== "boleta_simple" ? docNumber : undefined,
        docHolderName: docType === "factura" ? docHolderName : undefined,
      });
    } catch {
      const org = orgSettings as any;
      printReceipt({
        businessName: org?.name || "Restaurante",
        orderNumber: payment.order_number || "",
        createdAt: payment.created_at || new Date().toISOString(),
        items: [],
        subtotal: 0,
        tax: 0,
        total: payment.amount ?? 0,
        paymentMethod: payment.method,
        docType,
        docNumber: docType !== "boleta_simple" ? docNumber : undefined,
        docHolderName: docType === "factura" ? docHolderName : undefined,
      });
    } finally {
      setPrinting(false);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Imprimir Comprobante</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Tipo de Documento</Label>
            <Select value={docType} onValueChange={handleDocTypeChange}>
              <SelectTrigger>
                <SelectValue placeholder="Seleccionar tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="boleta_simple">Boleta Simple</SelectItem>
                <SelectItem value="boleta_electronica">Boleta Electronica</SelectItem>
                <SelectItem value="factura">Factura</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {docType === "boleta_electronica" && (
            <div className="space-y-2">
              <Label htmlFor="receiptDni">DNI</Label>
              <Input
                id="receiptDni"
                placeholder="12345678"
                maxLength={8}
                value={docNumber}
                onChange={(e) => setDocNumber(e.target.value.replace(/\D/g, "").slice(0, 8))}
              />
              {docNumber.length > 0 && docNumber.length !== 8 && (
                <p className="text-xs text-destructive">El DNI debe tener 8 digitos</p>
              )}
            </div>
          )}
          {docType === "factura" && (
            <>
              <div className="space-y-2">
                <Label htmlFor="receiptRuc">RUC</Label>
                <Input
                  id="receiptRuc"
                  placeholder="20123456789"
                  maxLength={11}
                  value={docNumber}
                  onChange={(e) => setDocNumber(e.target.value.replace(/\D/g, "").slice(0, 11))}
                />
                {docNumber.length > 0 && docNumber.length !== 11 && (
                  <p className="text-xs text-destructive">El RUC debe tener 11 digitos</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="receiptRazonSocial">Razon Social</Label>
                <Input
                  id="receiptRazonSocial"
                  placeholder="Nombre de la empresa"
                  value={docHolderName}
                  onChange={(e) => setDocHolderName(e.target.value)}
                />
              </div>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handlePrint}
            disabled={printing || !isFormValid()}
          >
            <Printer className="h-4 w-4 mr-2" />
            {printing ? "Imprimiendo..." : "Imprimir"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
