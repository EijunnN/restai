"use client";

import { useState } from "react";
import { Card, CardContent } from "@restai/ui/components/card";
import { Input } from "@restai/ui/components/input";
import { Label } from "@restai/ui/components/label";
import { Badge } from "@restai/ui/components/badge";
import { Button } from "@restai/ui/components/button";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@restai/ui/components/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@restai/ui/components/dialog";
import {
  Search,
  RefreshCw,
  Plus,
  DollarSign,
  CreditCard,
  Smartphone,
  Banknote,
  FileText,
  Printer,
} from "lucide-react";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import {
  usePayments,
  useCreatePayment,
  usePaymentSummary,
  useCreateInvoice,
} from "@/hooks/use-payments";
import { useOrgSettings, useBranchSettings } from "@/hooks/use-settings";
import { usePrintReceipt } from "@/components/print-ticket";
import { apiFetch } from "@/lib/fetcher";

const methodLabels: Record<string, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  yape: "Yape",
  plin: "Plin",
  transfer: "Transferencia",
  other: "Otro",
};

const methodIcons: Record<string, React.ReactNode> = {
  cash: <Banknote className="h-4 w-4" />,
  card: <CreditCard className="h-4 w-4" />,
  yape: <Smartphone className="h-4 w-4" />,
  plin: <Smartphone className="h-4 w-4" />,
  transfer: <DollarSign className="h-4 w-4" />,
  other: <DollarSign className="h-4 w-4" />,
};

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  completed: { label: "Completado", variant: "default" },
  pending: { label: "Pendiente", variant: "outline" },
  refunded: { label: "Reembolsado", variant: "destructive" },
};

const allMethods = ["all", "cash", "card", "yape", "plin", "transfer", "other"];

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-muted rounded ${className ?? ""}`} />;
}

export default function PaymentsPage() {
  const [search, setSearch] = useState("");
  const [methodFilter, setMethodFilter] = useState("all");
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<any>(null);
  const [receiptDialogOpen, setReceiptDialogOpen] = useState(false);
  const [receiptPayment, setReceiptPayment] = useState<any>(null);
  const [receiptDocType, setReceiptDocType] = useState<"boleta_simple" | "boleta_electronica" | "factura">("boleta_simple");
  const [receiptDocNumber, setReceiptDocNumber] = useState("");
  const [receiptDocHolderName, setReceiptDocHolderName] = useState("");
  const [receiptPrinting, setReceiptPrinting] = useState(false);

  // Payment form state
  const [paymentForm, setPaymentForm] = useState({
    orderId: "",
    method: "cash",
    amount: "",
    reference: "",
    tip: "",
  });

  // Invoice form state
  const [invoiceForm, setInvoiceForm] = useState({
    orderId: "",
    type: "boleta",
    customerName: "",
    customerDocType: "dni",
    customerDocNumber: "",
  });

  const { data, isLoading, error, refetch } = usePayments();
  const { data: summary } = usePaymentSummary();
  const createPayment = useCreatePayment();
  const createInvoice = useCreateInvoice();
  const { data: orgSettings } = useOrgSettings();
  const { data: branchSettings } = useBranchSettings();
  const printReceipt = usePrintReceipt();

  const openReceiptDialog = (payment: any) => {
    setReceiptPayment(payment);
    setReceiptDocType("boleta_simple");
    setReceiptDocNumber("");
    setReceiptDocHolderName("");
    setReceiptDialogOpen(true);
  };

  const isReceiptFormValid = () => {
    if (receiptDocType === "boleta_simple") return true;
    if (receiptDocType === "boleta_electronica") return /^\d{8}$/.test(receiptDocNumber);
    if (receiptDocType === "factura") return /^\d{11}$/.test(receiptDocNumber) && receiptDocHolderName.trim().length > 0;
    return false;
  };

  const handlePrintReceiptConfirm = async () => {
    if (!receiptPayment || !isReceiptFormValid()) return;
    setReceiptPrinting(true);
    try {
      const orderDetail = await apiFetch(`/api/orders/${receiptPayment.order_id}`);
      const org = orgSettings as any;
      const branch = branchSettings as any;
      const orderData = orderDetail as any;
      const items = orderData?.items || [];
      printReceipt({
        businessName: org?.name || "Restaurante",
        ruc: org?.settings?.ruc || undefined,
        address: branch?.address || undefined,
        orderNumber: receiptPayment.order_number || orderData?.order_number || "",
        createdAt: receiptPayment.created_at || new Date().toISOString(),
        items: items.map((i: any) => ({
          name: i.name,
          quantity: i.quantity,
          unit_price: i.unit_price,
          total: i.total,
        })),
        subtotal: orderData?.subtotal ?? 0,
        tax: orderData?.tax ?? 0,
        total: orderData?.total ?? 0,
        paymentMethod: receiptPayment.method,
        customerName: orderData?.customer_name || undefined,
        docType: receiptDocType,
        docNumber: receiptDocType !== "boleta_simple" ? receiptDocNumber : undefined,
        docHolderName: receiptDocType === "factura" ? receiptDocHolderName : undefined,
      });
    } catch {
      const org = orgSettings as any;
      printReceipt({
        businessName: org?.name || "Restaurante",
        orderNumber: receiptPayment.order_number || "",
        createdAt: receiptPayment.created_at || new Date().toISOString(),
        items: [],
        subtotal: 0,
        tax: 0,
        total: receiptPayment.amount ?? 0,
        paymentMethod: receiptPayment.method,
        docType: receiptDocType,
        docNumber: receiptDocType !== "boleta_simple" ? receiptDocNumber : undefined,
        docHolderName: receiptDocType === "factura" ? receiptDocHolderName : undefined,
      });
    } finally {
      setReceiptPrinting(false);
      setReceiptDialogOpen(false);
    }
  };

  const payments: any[] = data ?? [];

  const filteredPayments = payments.filter((p: any) => {
    const matchesSearch =
      (p.order_number || "").toLowerCase().includes(search.toLowerCase()) ||
      (p.reference || "").toLowerCase().includes(search.toLowerCase());
    const matchesMethod = methodFilter === "all" || p.method === methodFilter;
    return matchesSearch && matchesMethod;
  });

  const summaryData = summary as any;

  const getMethodTotal = (method: string) => {
    if (!summaryData?.byMethod) return 0;
    const found = summaryData.byMethod.find((m: any) => m.method === method);
    return found?.total || 0;
  };

  const handleCreatePayment = async () => {
    if (!paymentForm.orderId || !paymentForm.amount) return;
    try {
      await createPayment.mutateAsync({
        orderId: paymentForm.orderId,
        method: paymentForm.method,
        amount: Math.round(parseFloat(paymentForm.amount) * 100),
        reference: paymentForm.reference || undefined,
        tip: paymentForm.tip ? Math.round(parseFloat(paymentForm.tip) * 100) : 0,
      });
      setPaymentDialogOpen(false);
      setPaymentForm({ orderId: "", method: "cash", amount: "", reference: "", tip: "" });
    } catch {}
  };

  const handleCreateInvoice = async () => {
    if (!invoiceForm.orderId || !invoiceForm.customerName || !invoiceForm.customerDocNumber) return;
    try {
      await createInvoice.mutateAsync({
        orderId: invoiceForm.orderId,
        type: invoiceForm.type,
        customerName: invoiceForm.customerName,
        customerDocType: invoiceForm.customerDocType,
        customerDocNumber: invoiceForm.customerDocNumber,
      });
      setInvoiceDialogOpen(false);
      setInvoiceForm({
        orderId: "",
        type: "boleta",
        customerName: "",
        customerDocType: "dni",
        customerDocNumber: "",
      });
    } catch {}
  };

  const openInvoiceForPayment = (payment: any) => {
    setSelectedPayment(payment);
    setInvoiceForm({
      orderId: payment.order_id,
      type: "boleta",
      customerName: "",
      customerDocType: "dni",
      customerDocNumber: "",
    });
    setInvoiceDialogOpen(true);
  };

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Pagos</h1>
        </div>
        <div className="p-4 rounded-lg border border-destructive/50 bg-destructive/5 flex items-center justify-between">
          <p className="text-sm text-destructive">Error al cargar pagos: {(error as Error).message}</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Reintentar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Pagos</h1>
          <p className="text-muted-foreground">
            {isLoading ? "Cargando..." : `${payments.length} pagos registrados`}
          </p>
        </div>
        <Button onClick={() => setPaymentDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Registrar Pago
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Ingresos</p>
            <p className="text-xl font-bold">{formatCurrency(summaryData?.grandTotal || 0)}</p>
            <p className="text-xs text-muted-foreground">{summaryData?.totalCount || 0} pagos hoy</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Banknote className="h-3 w-3" /> Efectivo
            </div>
            <p className="text-lg font-bold">{formatCurrency(getMethodTotal("cash"))}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <CreditCard className="h-3 w-3" /> Tarjeta
            </div>
            <p className="text-lg font-bold">{formatCurrency(getMethodTotal("card"))}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Smartphone className="h-3 w-3" /> Yape/Plin
            </div>
            <p className="text-lg font-bold">
              {formatCurrency(getMethodTotal("yape") + getMethodTotal("plin"))}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Propinas</p>
            <p className="text-lg font-bold">{formatCurrency(summaryData?.tipTotal || 0)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Method filter pills */}
      <div className="flex flex-wrap gap-2">
        {allMethods.map((method) => (
          <button
            key={method}
            onClick={() => setMethodFilter(method)}
            className={cn(
              "px-3 py-1 rounded-full text-sm transition-colors border",
              methodFilter === method
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground border-border hover:bg-muted"
            )}
          >
            {method === "all" ? "Todos" : methodLabels[method]}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Buscar por orden o referencia..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Payment list table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left p-3 text-sm font-medium text-muted-foreground">Orden</th>
                  <th className="text-left p-3 text-sm font-medium text-muted-foreground">Metodo</th>
                  <th className="text-right p-3 text-sm font-medium text-muted-foreground">Monto</th>
                  <th className="text-right p-3 text-sm font-medium text-muted-foreground hidden sm:table-cell">Propina</th>
                  <th className="text-left p-3 text-sm font-medium text-muted-foreground hidden md:table-cell">Referencia</th>
                  <th className="text-right p-3 text-sm font-medium text-muted-foreground hidden lg:table-cell">Fecha</th>
                  <th className="text-center p-3 text-sm font-medium text-muted-foreground">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b">
                      <td className="p-3"><Skeleton className="h-4 w-20" /></td>
                      <td className="p-3"><Skeleton className="h-4 w-16" /></td>
                      <td className="p-3"><Skeleton className="h-4 w-16 ml-auto" /></td>
                      <td className="p-3 hidden sm:table-cell"><Skeleton className="h-4 w-12 ml-auto" /></td>
                      <td className="p-3 hidden md:table-cell"><Skeleton className="h-4 w-20" /></td>
                      <td className="p-3 hidden lg:table-cell"><Skeleton className="h-4 w-24 ml-auto" /></td>
                      <td className="p-3"><Skeleton className="h-6 w-16 mx-auto" /></td>
                    </tr>
                  ))
                ) : filteredPayments.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-sm text-muted-foreground">
                      {search || methodFilter !== "all" ? "No se encontraron pagos" : "No hay pagos registrados"}
                    </td>
                  </tr>
                ) : (
                  filteredPayments.map((payment: any) => (
                    <tr key={payment.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                      <td className="p-3 font-medium text-sm">{payment.order_number || "-"}</td>
                      <td className="p-3 text-sm">
                        <Badge variant="secondary" className="gap-1">
                          {methodIcons[payment.method]}
                          {methodLabels[payment.method] || payment.method}
                        </Badge>
                      </td>
                      <td className="p-3 text-sm font-medium text-right">
                        {formatCurrency(payment.amount || 0)}
                      </td>
                      <td className="p-3 text-sm text-muted-foreground text-right hidden sm:table-cell">
                        {(payment.tip || 0) > 0 ? formatCurrency(payment.tip) : "-"}
                      </td>
                      <td className="p-3 text-sm text-muted-foreground hidden md:table-cell">
                        {payment.reference || "-"}
                      </td>
                      <td className="p-3 text-sm text-muted-foreground text-right hidden lg:table-cell">
                        {payment.created_at ? formatDate(payment.created_at) : "-"}
                      </td>
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openInvoiceForPayment(payment)}
                          >
                            <FileText className="h-3 w-3 mr-1" />
                            Comprobante
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            onClick={() => openReceiptDialog(payment)}
                            title="Imprimir Boleta"
                          >
                            <Printer className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Create Payment Dialog */}
      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
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
                value={paymentForm.orderId}
                onChange={(e) => setPaymentForm({ ...paymentForm, orderId: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="method">Metodo de Pago</Label>
              <Select value={paymentForm.method} onValueChange={(v) => setPaymentForm({ ...paymentForm, method: v })}>
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
                  value={paymentForm.amount}
                  onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })}
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
                  value={paymentForm.tip}
                  onChange={(e) => setPaymentForm({ ...paymentForm, tip: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="reference">Referencia</Label>
              <Input
                id="reference"
                placeholder="Numero de operacion, etc."
                value={paymentForm.reference}
                onChange={(e) => setPaymentForm({ ...paymentForm, reference: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleCreatePayment}
              disabled={createPayment.isPending || !paymentForm.orderId || !paymentForm.amount}
            >
              {createPayment.isPending ? "Registrando..." : "Registrar Pago"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Receipt Type Dialog */}
      <Dialog open={receiptDialogOpen} onOpenChange={setReceiptDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Imprimir Comprobante</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Tipo de Documento</Label>
              <Select value={receiptDocType} onValueChange={(v) => {
                setReceiptDocType(v as "boleta_simple" | "boleta_electronica" | "factura");
                setReceiptDocNumber("");
                setReceiptDocHolderName("");
              }}>
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
            {receiptDocType === "boleta_electronica" && (
              <div className="space-y-2">
                <Label htmlFor="receiptDni">DNI</Label>
                <Input
                  id="receiptDni"
                  placeholder="12345678"
                  maxLength={8}
                  value={receiptDocNumber}
                  onChange={(e) => setReceiptDocNumber(e.target.value.replace(/\D/g, "").slice(0, 8))}
                />
                {receiptDocNumber.length > 0 && receiptDocNumber.length !== 8 && (
                  <p className="text-xs text-destructive">El DNI debe tener 8 digitos</p>
                )}
              </div>
            )}
            {receiptDocType === "factura" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="receiptRuc">RUC</Label>
                  <Input
                    id="receiptRuc"
                    placeholder="20123456789"
                    maxLength={11}
                    value={receiptDocNumber}
                    onChange={(e) => setReceiptDocNumber(e.target.value.replace(/\D/g, "").slice(0, 11))}
                  />
                  {receiptDocNumber.length > 0 && receiptDocNumber.length !== 11 && (
                    <p className="text-xs text-destructive">El RUC debe tener 11 digitos</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="receiptRazonSocial">Razon Social</Label>
                  <Input
                    id="receiptRazonSocial"
                    placeholder="Nombre de la empresa"
                    value={receiptDocHolderName}
                    onChange={(e) => setReceiptDocHolderName(e.target.value)}
                  />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReceiptDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handlePrintReceiptConfirm}
              disabled={receiptPrinting || !isReceiptFormValid()}
            >
              <Printer className="h-4 w-4 mr-2" />
              {receiptPrinting ? "Imprimiendo..." : "Imprimir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Invoice Dialog */}
      <Dialog open={invoiceDialogOpen} onOpenChange={setInvoiceDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Generar Comprobante</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invoiceType">Tipo de Comprobante</Label>
              <Select value={invoiceForm.type} onValueChange={(v) => setInvoiceForm({ ...invoiceForm, type: v })}>
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
                value={invoiceForm.customerName}
                onChange={(e) => setInvoiceForm({ ...invoiceForm, customerName: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="docType">Tipo de Documento</Label>
                <Select value={invoiceForm.customerDocType} onValueChange={(v) => setInvoiceForm({ ...invoiceForm, customerDocType: v })}>
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
                    invoiceForm.customerDocType === "dni"
                      ? "12345678"
                      : invoiceForm.customerDocType === "ruc"
                      ? "20123456789"
                      : "AB1234567"
                  }
                  value={invoiceForm.customerDocNumber}
                  onChange={(e) =>
                    setInvoiceForm({ ...invoiceForm, customerDocNumber: e.target.value })
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
            <Button variant="outline" onClick={() => setInvoiceDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleCreateInvoice}
              disabled={
                createInvoice.isPending ||
                !invoiceForm.customerName ||
                !invoiceForm.customerDocNumber
              }
            >
              {createInvoice.isPending ? "Generando..." : "Generar Comprobante"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
