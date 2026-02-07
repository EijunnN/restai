"use client";

import { useRef, useCallback } from "react";

interface OrderItem {
  name: string;
  quantity: number;
  unit_price: number;
  total: number;
  notes?: string;
}

interface KitchenTicketData {
  orderNumber: string;
  tableNumber?: string | number;
  customerName?: string;
  createdAt: string;
  items: OrderItem[];
  notes?: string;
}

interface ReceiptTicketData {
  businessName: string;
  ruc?: string;
  address?: string;
  orderNumber: string;
  createdAt: string;
  items: OrderItem[];
  subtotal: number;
  tax: number;
  total: number;
  paymentMethod?: string;
  customerName?: string;
}

function formatCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

function formatDateTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString("es-PE", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const methodLabels: Record<string, string> = {
  cash: "Efectivo",
  card: "Tarjeta",
  yape: "Yape",
  plin: "Plin",
  transfer: "Transferencia",
  other: "Otro",
};

function buildKitchenTicketHtml(data: KitchenTicketData): string {
  const itemsHtml = data.items
    .map(
      (item) =>
        `<tr>
          <td style="text-align:left;padding:2px 0;">${item.quantity}x ${item.name}${item.notes ? `<br><span style="font-size:10px;color:#666;">* ${item.notes}</span>` : ""}</td>
        </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Ticket Cocina - #${data.orderNumber}</title>
  <style>
    @page { size: 80mm auto; margin: 2mm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Courier New', Courier, monospace; font-size: 12px; width: 76mm; color: #000; }
    .center { text-align: center; }
    .bold { font-weight: bold; }
    .divider { border-top: 1px dashed #000; margin: 4px 0; }
    .order-num { font-size: 28px; font-weight: bold; text-align: center; letter-spacing: 2px; }
    table { width: 100%; border-collapse: collapse; }
    td { vertical-align: top; }
  </style>
</head>
<body>
  <div class="center bold" style="font-size:14px;">COCINA</div>
  <div class="divider"></div>
  <div class="order-num">#${data.orderNumber}</div>
  <div class="divider"></div>
  <table>
    <tr>
      <td>${data.tableNumber ? `Mesa: ${data.tableNumber}` : "Para llevar"}</td>
      <td style="text-align:right;">${formatDateTime(data.createdAt)}</td>
    </tr>
    ${data.customerName ? `<tr><td colspan="2">Cliente: ${data.customerName}</td></tr>` : ""}
  </table>
  <div class="divider"></div>
  <table>${itemsHtml}</table>
  ${data.notes ? `<div class="divider"></div><div style="font-size:11px;">Nota: ${data.notes}</div>` : ""}
  <div class="divider"></div>
  <div class="center" style="font-size:10px;margin-top:4px;">*** FIN ***</div>
</body>
</html>`;
}

function buildReceiptTicketHtml(data: ReceiptTicketData): string {
  const itemsHtml = data.items
    .map(
      (item) =>
        `<tr>
          <td style="text-align:left;padding:1px 0;">${item.quantity}x ${item.name}</td>
          <td style="text-align:right;padding:1px 0;">S/ ${formatCents(item.total)}</td>
        </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Boleta - #${data.orderNumber}</title>
  <style>
    @page { size: 80mm auto; margin: 2mm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Courier New', Courier, monospace; font-size: 11px; width: 76mm; color: #000; }
    .center { text-align: center; }
    .bold { font-weight: bold; }
    .divider { border-top: 1px dashed #000; margin: 4px 0; }
    table { width: 100%; border-collapse: collapse; }
    td { vertical-align: top; }
    .totals td { padding: 1px 0; }
  </style>
</head>
<body>
  <div class="center bold" style="font-size:14px;">${data.businessName}</div>
  ${data.ruc ? `<div class="center" style="font-size:10px;">RUC: ${data.ruc}</div>` : ""}
  ${data.address ? `<div class="center" style="font-size:10px;">${data.address}</div>` : ""}
  <div class="divider"></div>
  <div class="center bold">BOLETA DE VENTA</div>
  <div class="center" style="font-size:10px;">${formatDateTime(data.createdAt)}</div>
  <div class="center">Orden: #${data.orderNumber}</div>
  ${data.customerName ? `<div>Cliente: ${data.customerName}</div>` : ""}
  <div class="divider"></div>
  <table>${itemsHtml}</table>
  <div class="divider"></div>
  <table class="totals">
    <tr>
      <td>Subtotal:</td>
      <td style="text-align:right;">S/ ${formatCents(data.subtotal)}</td>
    </tr>
    <tr>
      <td>IGV (18%):</td>
      <td style="text-align:right;">S/ ${formatCents(data.tax)}</td>
    </tr>
    <tr class="bold">
      <td style="font-size:13px;padding-top:2px;">TOTAL:</td>
      <td style="text-align:right;font-size:13px;font-weight:bold;padding-top:2px;">S/ ${formatCents(data.total)}</td>
    </tr>
  </table>
  <div class="divider"></div>
  ${data.paymentMethod ? `<div>Metodo de pago: ${methodLabels[data.paymentMethod] || data.paymentMethod}</div>` : ""}
  <div class="divider"></div>
  <div class="center" style="font-size:10px;margin-top:4px;">Gracias por su preferencia</div>
  <div class="center" style="font-size:9px;">*** FIN ***</div>
</body>
</html>`;
}

function printHtml(html: string) {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.top = "-10000px";
  iframe.style.left = "-10000px";
  iframe.style.width = "80mm";
  iframe.style.height = "0";
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!doc) {
    document.body.removeChild(iframe);
    return;
  }

  doc.open();
  doc.write(html);
  doc.close();

  iframe.onload = () => {
    setTimeout(() => {
      iframe.contentWindow?.print();
      setTimeout(() => {
        document.body.removeChild(iframe);
      }, 1000);
    }, 250);
  };
}

export function usePrintKitchenTicket() {
  return useCallback((data: KitchenTicketData) => {
    const html = buildKitchenTicketHtml(data);
    printHtml(html);
  }, []);
}

export function usePrintReceipt() {
  return useCallback((data: ReceiptTicketData) => {
    const html = buildReceiptTicketHtml(data);
    printHtml(html);
  }, []);
}
