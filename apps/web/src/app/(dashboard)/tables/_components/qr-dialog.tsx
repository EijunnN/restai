"use client";

import { Button } from "@restai/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@restai/ui/components/dialog";
import { Download } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://app.hosteleria.me";

interface QrDialogProps {
  table: any | null;
  branchSlug: string;
  onClose: () => void;
}

export function QrDialog({ table, branchSlug, onClose }: QrDialogProps) {
  const qrUrl = table ? `${APP_URL}/${branchSlug}/${table.qr_code}` : "";

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
          <DialogTitle>Codigo QR - Mesa {table?.number}</DialogTitle>
        </DialogHeader>
        {table && (
          <div className="flex flex-col items-center gap-4 py-4">
            <div
              className="bg-white p-4 rounded-lg"
              id={`qr-svg-${table.id}`}
            >
              <QRCodeSVG value={qrUrl} size={240} level="M" />
            </div>
            <p className="text-sm text-muted-foreground text-center break-all">
              {qrUrl}
            </p>
            <p className="text-xs text-muted-foreground">
              Codigo: {table.qr_code}
            </p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cerrar
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
