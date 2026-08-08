"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Mic, ChevronRight } from "lucide-react";

/**
 * Puerta de entrada al mesero por voz desde la carta.
 *
 * Se pinta SOLO si el despliegue tiene la función encendida: sin
 * `OPENAI_API_KEY` el backend responde `enabled:false` y aquí no aparece nada.
 * Un botón que lleva a una pantalla que no puede funcionar es peor que no tener
 * el botón, sobre todo en la mesa de un cliente que paga.
 *
 * Mientras se resuelve la consulta tampoco se reserva espacio: que la carta no
 * dé un salto de maquetación al llegar la respuesta.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

interface VoiceEntryButtonProps {
  branchSlug: string;
  tableCode: string;
}

export function VoiceEntryButton({ branchSlug, tableCode }: VoiceEntryButtonProps) {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch(`${API_URL}/api/voice/config`)
      .then((res) => res.json())
      .then((result) => {
        if (!cancelled && result?.success && result.data?.enabled) setEnabled(true);
      })
      .catch(() => {
        // Silencio a propósito: es una función opcional. Si no se puede saber
        // si está disponible, la carta táctil sigue funcionando igual.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!enabled) return null;

  return (
    <Link
      href={`/${branchSlug}/${tableCode}/voz`}
      className="group relative flex items-center gap-3 overflow-hidden rounded-2xl bg-gradient-to-r from-indigo-500/15 via-fuchsia-500/10 to-cyan-500/15 px-4 py-3 ring-1 ring-primary/20 transition-transform active:scale-[0.99]"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-indigo-500 to-fuchsia-500 text-white shadow-lg">
        <Mic className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">Pide hablando</span>
        <span className="block truncate text-xs text-muted-foreground">
          Conversa con nuestro mesero y te lo muestra en pantalla
        </span>
      </span>
      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}
