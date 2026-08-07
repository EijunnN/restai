"use client";

import { Button } from "@restai/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@restai/ui/components/dialog";
import { Download, Printer } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.hosteleria.me";

interface QrDialogProps {
  table: any | null;
  branchSlug: string;
  onClose: () => void;
}

export function QrDialog({ table, branchSlug, onClose }: QrDialogProps) {
  const qrUrl = table ? `${APP_URL}/${branchSlug}/${table.qr_code}` : "";
  // URL corta y dictable para quien no puede escanear. Se muestra sin protocolo:
  // es lo que la persona va a teclear en el navegador.
  const codeEntryUrl = `${APP_URL.replace(/^https?:\/\//, "")}/${branchSlug}/codigo`;

  /**
   * Cartel imprimible de la mesa: QR grande + código corto + instrucciones.
   * Va en una ventana aparte porque el diálogo vive dentro del layout del panel
   * y arrastraría la barra lateral al papel.
   */
  const handlePrintSign = () => {
    if (!table) return;
    const container = document.getElementById(`qr-svg-${table.id}`);
    const svgEl = container?.querySelector("svg");
    if (!svgEl) return;
    const svgData = new XMLSerializer().serializeToString(svgEl);
    const svgDataUri =
      "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgData)));

    const win = window.open("", "_blank", "width=800,height=1000");
    if (!win) return;
    // Los valores interpolados son del propio panel (número de mesa, slug,
    // código generado), no texto que escriba un comensal.
    win.document.write(`<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><title>Mesa ${table.number}</title>
<style>
  @page { size: A5; margin: 12mm; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; text-align: center; color: #000; }
  h1 { font-size: 42px; margin: 0 0 4px; letter-spacing: -1px; }
  .sub { font-size: 15px; color: #555; margin-bottom: 18px; }
  img { width: 300px; height: 300px; }
  .alt { margin-top: 22px; border-top: 2px dashed #999; padding-top: 16px; }
  .alt-label { font-size: 13px; color: #555; text-transform: uppercase; letter-spacing: 1px; }
  .alt-url { font-size: 19px; font-weight: 600; margin: 6px 0; }
  .code { font-size: 46px; font-weight: 800; letter-spacing: 10px; margin-top: 8px; }
</style></head>
<body>
  <h1>Mesa ${table.number}</h1>
  <div class="sub">Escanea para ver la carta y pedir</div>
  <img src="${svgDataUri}" alt="Código QR de la mesa ${table.number}">
  <div class="alt">
    <div class="alt-label">¿No puedes escanear?</div>
    <div class="alt-url">${codeEntryUrl}</div>
    <div class="alt-label">y escribe este código</div>
    <div class="code">${table.short_code ?? ""}</div>
  </div>
  <script>window.addEventListener("load", function(){ setTimeout(function(){ window.print(); }, 200); });</script>
</body></html>`);
    win.document.close();
  };

  const handleDownloadQR = () => {
    if (!table) return;
    const container = document.getElementById(`qr-svg-${table.id}`);
    const svgEl = container?.querySelector("svg");
    if (!svgEl) return;
    const svgData = new XMLSerializer().serializeToString(svgEl);
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 400;
    const ctx = canvas.getContext("2d");
    const img = new Image();
    img.onload = () => {
      ctx?.drawImage(img, 0, 0, 400, 400);
      const a = document.createElement("a");
      a.download = `mesa-${table.number}-qr.png`;
      a.href = canvas.toDataURL("image/png");
      a.click();
    };
    img.src =
      "data:image/svg+xml;base64," +
      btoa(unescape(encodeURIComponent(svgData)));
  };

  return (
    <Dialog open={!!table} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Código QR - Mesa {table?.number}</DialogTitle>
        </DialogHeader>
        {table && (
          <div className="flex flex-col items-center gap-4 py-4">
            <div
              className="bg-white p-4 rounded-lg"
              id={`qr-svg-${table.id}`}
            >
              <QRCodeSVG value={qrUrl} size={240} level="M" />
            </div>

            {/*
              Plan B impreso junto al QR. Sin esto, el comensal que no puede
              escanear (sin cámara, sin datos, sticker despegado, o que
              simplemente no usa QR) deja la mesa fuera del sistema.
            */}
            <div className="w-full rounded-xl border border-dashed bg-muted/40 p-4 text-center">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                ¿No puedes escanear?
              </p>
              <p className="mt-1 text-sm">
                Entra a <span className="font-medium">{codeEntryUrl}</span>
              </p>
              <p className="mt-2 text-xs text-muted-foreground">y escribe el código</p>
              <p className="mt-1 text-3xl font-black tracking-[0.3em]">{table.short_code}</p>
            </div>

            <p className="text-xs text-muted-foreground text-center break-all">
              {qrUrl}
            </p>
          </div>
        )}
        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="outline" onClick={onClose}>
            Cerrar
          </Button>
          <Button variant="outline" onClick={handlePrintSign}>
            <Printer className="h-4 w-4 mr-2" />
            Imprimir cartel
          </Button>
          <Button onClick={handleDownloadQR}>
            <Download className="h-4 w-4 mr-2" />
            Descargar PNG
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
