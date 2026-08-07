"use client";

import { useMemo, useState } from "react";
import { ArrowRight, ChevronDown, Code2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildChanges, wasTruncated } from "./audit-format";

/**
 * Detalle de una traza de auditoría en lenguaje de negocio.
 *
 * La traducción vive en `audit-format.ts`; aquí solo se decide la forma:
 * comparación (antes → después) cuando hay dos estados, y lista simple cuando
 * el movimiento fue un alta o una baja. El JSON crudo sigue accesible, plegado,
 * para cuando haya que escalar una incidencia a soporte.
 */
interface Props {
  before: unknown;
  after: unknown;
}

export function ChangeList({ before, after }: Props) {
  const [showRaw, setShowRaw] = useState(false);

  const rows = useMemo(() => buildChanges(before, after), [before, after]);
  const truncated = wasTruncated(before) || wasTruncated(after);

  // Sin estado previo es un alta, y sin estado posterior una baja: en ambos
  // casos no hay nada que comparar, solo datos que enseñar.
  const isCreation = before === null || before === undefined;
  const isDeletion = after === null || after === undefined;
  const isComparison = !isCreation && !isDeletion;

  const visible = isComparison ? rows.filter((r) => r.changed) : rows;

  return (
    <div className="mt-3 rounded-lg border bg-muted/30 p-3">
      {truncated && (
        <p className="mb-2 rounded-md bg-amber-500/10 px-2 py-1.5 text-xs text-amber-600 dark:text-amber-400">
          El detalle era muy extenso y se guardó recortado.
        </p>
      )}

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {isComparison
            ? "Se guardó el registro, pero ningún dato llegó a cambiar."
            : "Sin datos adicionales."}
        </p>
      ) : (
        <>
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {isComparison ? "Qué cambió" : isCreation ? "Datos registrados" : "Datos eliminados"}
          </p>
          <dl className="space-y-1.5">
            {visible.map((row) => (
              <div
                key={row.path}
                className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm"
              >
                <dt className="text-muted-foreground">{row.label}:</dt>
                {isComparison ? (
                  <dd className="flex flex-wrap items-baseline gap-2">
                    <span className="text-muted-foreground line-through decoration-muted-foreground/50">
                      {row.before}
                    </span>
                    <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="font-medium">{row.after}</span>
                  </dd>
                ) : (
                  <dd className="font-medium">{isCreation ? row.after : row.before}</dd>
                )}
              </div>
            ))}
          </dl>
        </>
      )}

      {/* Escotilla para soporte: el dato exacto, tal cual se guardó. */}
      <button
        type="button"
        onClick={() => setShowRaw((v) => !v)}
        className="mt-3 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <Code2 className="h-3 w-3" />
        Datos técnicos
        <ChevronDown className={cn("h-3 w-3 transition-transform", showRaw && "rotate-180")} />
      </button>
      {showRaw && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">Antes</p>
            <pre className="max-h-40 overflow-auto rounded-md bg-background p-2 text-[11px]">
              {JSON.stringify(before ?? null, null, 2)}
            </pre>
          </div>
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
              Después
            </p>
            <pre className="max-h-40 overflow-auto rounded-md bg-background p-2 text-[11px]">
              {JSON.stringify(after ?? null, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
