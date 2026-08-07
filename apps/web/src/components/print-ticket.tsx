"use client";

import { useCallback } from "react";

interface OrderItem {
  name: string;
  quantity: number;
  unit_price: number;
  total: number;
  notes?: string;
  modifiers?: { name: string }[];
}

interface KitchenTicketData {
  orderNumber: string;
  tableNumber?: string | number;
  orderType?: string;
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
  /** Descuento total en céntimos (cupón + canje). Se imprime solo si es > 0. */
  discount?: number;
  /** Costo de delivery en céntimos. Se imprime solo si es > 0. */
  deliveryFee?: number;
  tax: number;
  /** Tasa de IGV en centésimas de punto (1800 = 18.00%). Por defecto 1800. */
  taxRate?: number;
  total: number;
  paymentMethod?: string;
  customerName?: string;
  docType?: "boleta_simple" | "boleta_electronica" | "factura";
  docNumber?: string;
  docHolderName?: string;
}

/**
 * Escapa texto para interpolarlo en el HTML del ticket.
 *
 * CRÍTICO: los tickets incluyen texto que escribe el comensal desde su móvil
 * (notas del pedido, nombre, nombres de modificadores). Sin escapar, una nota
 * como `<img src=x onerror=...>` se ejecutaría al imprimir la comanda. El iframe
 * de impresión además corre en sandbox sin `allow-same-origin` (ver printHtml),
 * de modo que ni siquiera un escape roto daría acceso al localStorage del staff.
 */
function esc(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** 1800 -> "18", 1850 -> "18.5" */
function formatTaxRate(rate: number): string {
  const pct = rate / 100;
  return Number.isInteger(pct) ? String(pct) : pct.toFixed(2).replace(/0$/, "");
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
          <td style="text-align:left;padding:2px 0;">${esc(item.quantity)}x ${esc(item.name)}${
            item.modifiers && item.modifiers.length > 0
              ? item.modifiers
                  .map(
                    (m) => `<br><span style="font-size:11px;">&nbsp;&nbsp;+ ${esc(m.name)}</span>`,
                  )
                  .join("")
              : ""
          }${
            item.notes
              ? `<br><span style="font-size:10px;color:#666;">* ${esc(item.notes)}</span>`
              : ""
          }</td>
        </tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Ticket Cocina - #${esc(data.orderNumber)}</title>
  <style>
    ${thermalStyles(80)}
    .order-num { font-size: 28px; font-weight: bold; text-align: center; letter-spacing: 2px; }
  </style>
</head>
<body>
  <div class="center bold" style="font-size:14px;">COCINA</div>
  <div class="divider"></div>
  <div class="order-num">#${esc(data.orderNumber)}</div>
  <div class="divider"></div>
  <table>
    <tr>
      <td>${
        data.tableNumber !== undefined && data.tableNumber !== null && data.tableNumber !== ""
          ? `Mesa: ${esc(data.tableNumber)}`
          : data.orderType === "takeout"
            ? "Para llevar"
            : data.orderType === "delivery"
              ? "Delivery"
              : "En local"
      }</td>
      <td style="text-align:right;">${esc(formatDateTime(data.createdAt))}</td>
    </tr>
    ${data.customerName ? `<tr><td colspan="2">Cliente: ${esc(data.customerName)}</td></tr>` : ""}
  </table>
  <div class="divider"></div>
  <table>${itemsHtml}</table>
  ${
    data.notes
      ? `<div class="divider"></div><div style="font-size:11px;">Nota: ${esc(data.notes)}</div>`
      : ""
  }
  <div class="divider"></div>
  <div class="center" style="font-size:10px;margin-top:4px;">*** FIN ***</div>
  ${AUTO_PRINT_SCRIPT}
</body>
</html>`;
}

function thermalStyles(widthMm: number = 80): string {
  const contentWidth = widthMm - 4;
  return `
    @page { size: ${widthMm}mm auto; margin: 0; padding: 0; }
    @media print {
      html, body { width: ${widthMm}mm !important; margin: 0 !important; padding: 1mm 2mm !important; }
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: ${contentWidth}mm; margin: 0; padding: 1mm 2mm; }
    body { font-family: 'Courier New', Courier, monospace; font-size: 12px; color: #000; line-height: 1.3; }
    .center { text-align: center; }
    .bold { font-weight: bold; }
    .divider { border-top: 1px dashed #000; margin: 3px 0; }
    table { width: 100%; border-collapse: collapse; }
    td { vertical-align: top; }
  `;
}

function buildReceiptTicketHtml(data: ReceiptTicketData): string {
  const itemsHtml = data.items
    .map(
      (item) =>
        `<tr>
          <td style="text-align:left;padding:1px 0;">${esc(item.quantity)}x ${esc(item.name)}</td>
          <td style="text-align:right;padding:1px 0;white-space:nowrap;">S/ ${esc(formatCents(item.total))}</td>
        </tr>`,
    )
    .join("");

  // Determine document title and customer info based on docType
  let docTitle = "BOLETA DE VENTA";
  let docInfoHtml = "";
  if (data.docType === "boleta_electronica") {
    docTitle = "BOLETA DE VENTA ELECTRONICA";
    if (data.docNumber) {
      docInfoHtml = `<div>DNI: ${esc(data.docNumber)}</div>`;
    }
    if (data.customerName) {
      docInfoHtml += `<div>Cliente: ${esc(data.customerName)}</div>`;
    }
  } else if (data.docType === "factura") {
    docTitle = "FACTURA";
    if (data.docNumber) {
      docInfoHtml = `<div>RUC: ${esc(data.docNumber)}</div>`;
    }
    if (data.docHolderName) {
      docInfoHtml += `<div>Razon Social: ${esc(data.docHolderName)}</div>`;
    }
  } else {
    // boleta_simple or default
    if (data.customerName) {
      docInfoHtml = `<div>Cliente: ${esc(data.customerName)}</div>`;
    }
  }

  // El servidor calcula total = (subtotal - discount) + tax + deliveryFee.
  // El ticket debe reflejar TODAS esas líneas o la suma impresa no cuadra y el
  // comensal desconfía del cobro.
  const discount = data.discount ?? 0;
  const deliveryFee = data.deliveryFee ?? 0;
  const taxRate = data.taxRate ?? 1800;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${esc(docTitle)} - #${esc(data.orderNumber)}</title>
  <style>
    ${thermalStyles(80)}
    .totals td { padding: 1px 0; }
  </style>
</head>
<body>
  <div class="center bold" style="font-size:14px;">${esc(data.businessName)}</div>
  ${data.ruc ? `<div class="center" style="font-size:10px;">RUC: ${esc(data.ruc)}</div>` : ""}
  ${data.address ? `<div class="center" style="font-size:10px;">${esc(data.address)}</div>` : ""}
  <div class="divider"></div>
  <div class="center bold">${esc(docTitle)}</div>
  <div class="center" style="font-size:10px;">${esc(formatDateTime(data.createdAt))}</div>
  <div class="center">Orden: #${esc(data.orderNumber)}</div>
  ${docInfoHtml}
  <div class="divider"></div>
  <table>${itemsHtml}</table>
  <div class="divider"></div>
  <table class="totals">
    <tr>
      <td>Subtotal:</td>
      <td style="text-align:right;">S/ ${esc(formatCents(data.subtotal))}</td>
    </tr>
    ${
      discount > 0
        ? `<tr>
      <td>Descuento:</td>
      <td style="text-align:right;">- S/ ${esc(formatCents(discount))}</td>
    </tr>`
        : ""
    }
    <tr>
      <td>IGV (${esc(formatTaxRate(taxRate))}%):</td>
      <td style="text-align:right;">S/ ${esc(formatCents(data.tax))}</td>
    </tr>
    ${
      deliveryFee > 0
        ? `<tr>
      <td>Delivery:</td>
      <td style="text-align:right;">S/ ${esc(formatCents(deliveryFee))}</td>
    </tr>`
        : ""
    }
    <tr class="bold">
      <td style="font-size:13px;padding-top:2px;">TOTAL:</td>
      <td style="text-align:right;font-size:13px;font-weight:bold;padding-top:2px;">S/ ${esc(formatCents(data.total))}</td>
    </tr>
  </table>
  <div class="divider"></div>
  ${
    data.paymentMethod
      ? `<div>Método de pago: ${esc(methodLabels[data.paymentMethod] || data.paymentMethod)}</div>`
      : ""
  }
  <div class="divider"></div>
  <div class="center" style="font-size:10px;margin-top:4px;">Gracias por su preferencia</div>
  <div class="center" style="font-size:9px;">*** FIN ***</div>
  ${AUTO_PRINT_SCRIPT}
</body>
</html>`;
}

/**
 * El iframe corre en sandbox sin `allow-same-origin`, así que el padre no puede
 * alcanzar su `contentWindow.print()`. La impresión se dispara desde dentro.
 */
const AUTO_PRINT_SCRIPT = `<script>
  window.addEventListener("load", function () {
    setTimeout(function () { window.focus(); window.print(); }, 150);
  });
</script>`;

function printHtml(html: string) {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.top = "-10000px";
  iframe.style.left = "-10000px";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "none";

  // Aislamiento: origen opaco. `allow-scripts` habilita el auto-print interno y
  // `allow-modals` permite el diálogo de impresión. Sin `allow-same-origin`, el
  // documento del ticket no puede leer localStorage, cookies ni el DOM del padre,
  // por lo que un escape roto no puede escalar a robo de sesión del staff.
  iframe.setAttribute("sandbox", "allow-scripts allow-modals");
  iframe.srcdoc = html;

  document.body.appendChild(iframe);

  // El diálogo de impresión es modal y bloquea el hilo hasta que el usuario
  // decide; retiramos el iframe con holgura después de que se resuelva.
  const cleanup = () => {
    if (iframe.parentNode) document.body.removeChild(iframe);
  };
  window.setTimeout(cleanup, 60_000);
  iframe.addEventListener("load", () => {
    window.setTimeout(cleanup, 5_000);
  });
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

export type { KitchenTicketData, ReceiptTicketData, OrderItem };
