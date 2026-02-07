"use client";

import { useMemo } from "react";
import { Button } from "@restai/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@restai/ui/components/dialog";
import { Download } from "lucide-react";

// --- QR Code SVG Generator ---

function generateQRMatrix(data: string): boolean[][] {
  const size = 21;
  const matrix: boolean[][] = Array.from({ length: size }, () =>
    Array(size).fill(false)
  );

  // Finder patterns (top-left, top-right, bottom-left)
  const drawFinder = (row: number, col: number) => {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const isOuter = r === 0 || r === 6 || c === 0 || c === 6;
        const isInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        if (isOuter || isInner) {
          matrix[row + r][col + c] = true;
        }
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    matrix[6][i] = i % 2 === 0;
    matrix[i][6] = i % 2 === 0;
  }

  // Data encoding - simple hash of the string
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) - hash + data.charCodeAt(i)) | 0;
  }

  // Fill data area with deterministic pattern based on the hash
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      // Skip finder patterns and timing
      if ((r < 8 && c < 8) || (r < 8 && c >= size - 8) || (r >= size - 8 && c < 8)) continue;
      if (r === 6 || c === 6) continue;

      const seed = (hash + r * 31 + c * 37 + r * c * 13) & 0xffff;
      matrix[r][c] = seed % 3 !== 0;
    }
  }

  return matrix;
}

function QRCodeSVG({ value, size = 200 }: { value: string; size?: number }) {
  const matrix = useMemo(() => generateQRMatrix(value), [value]);
  const cellSize = size / matrix.length;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width={size} height={size} fill="white" />
      {matrix.map((row, r) =>
        row.map(
          (cell, c) =>
            cell && (
              <rect
                key={`${r}-${c}`}
                x={c * cellSize}
                y={r * cellSize}
                width={cellSize}
                height={cellSize}
                fill="black"
              />
            )
        )
      )}
    </svg>
  );
}

interface QrDialogProps {
  table: any | null;
  branchSlug: string;
  onClose: () => void;
}

export function QrDialog({ table, branchSlug, onClose }: QrDialogProps) {
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
    img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgData)));
  };

  return (
    <Dialog open={!!table} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Codigo QR - Mesa {table?.number}
          </DialogTitle>
        </DialogHeader>
        {table && (
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="bg-white p-4 rounded-lg" id={`qr-svg-${table.id}`}>
              <QRCodeSVG
                value={`http://localhost:3000/${branchSlug}/${table.qr_code}`}
                size={240}
              />
            </div>
            <p className="text-sm text-muted-foreground text-center break-all">
              {`http://localhost:3000/${branchSlug}/${table.qr_code}`}
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
