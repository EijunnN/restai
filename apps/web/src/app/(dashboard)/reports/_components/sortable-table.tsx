"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type SortDirection = "asc" | "desc";

export interface SortColumn<T> {
  /** Identificador estable de la columna (se usa como clave de ordenación). */
  key: string;
  header: string;
  /** Valor con el que se ordena. Devuelve número para importes y recuentos. */
  value: (row: T) => string | number;
  /** Contenido pintado. Si se omite, se pinta `value`. */
  cell?: (row: T) => ReactNode;
  align?: "left" | "right";
  /** Dirección al pulsar la columna por primera vez. Los importes empiezan de mayor a menor. */
  defaultDirection?: SortDirection;
  /** Columna no ordenable (p. ej. un desglose). */
  sortable?: boolean;
  className?: string;
}

interface SortableTableProps<T> {
  columns: SortColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  initialSort: { key: string; direction: SortDirection };
  emptyMessage: string;
  /** Fila de totales: se pinta siempre al final y nunca se ordena. */
  footer?: ReactNode;
  /** Descripción accesible de la tabla. */
  caption?: string;
}

/**
 * Tabla ordenable por columna.
 *
 * En móvil la tabla se desplaza dentro de su propio contenedor: nunca provoca
 * scroll horizontal en la página ni esconde columnas, que en un reporte de
 * ventas es justo lo que el usuario ha venido a leer.
 */
export function SortableTable<T>({
  columns,
  rows,
  rowKey,
  initialSort,
  emptyMessage,
  footer,
  caption,
}: SortableTableProps<T>) {
  const [sort, setSort] = useState<{ key: string; direction: SortDirection }>(initialSort);

  const sortedRows = useMemo(() => {
    const column = columns.find((c) => c.key === sort.key);
    if (!column) return rows;
    const factor = sort.direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = column.value(a);
      const vb = column.value(b);
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * factor;
      return String(va).localeCompare(String(vb), "es", { sensitivity: "base" }) * factor;
    });
    // `columns` se reconstruye en cada render del padre; ordenar de nuevo una
    // lista de plantilla es irrelevante frente a arriesgar datos desordenados.
  }, [rows, sort, columns]);

  const toggle = (column: SortColumn<T>) => {
    setSort((prev) =>
      prev.key === column.key
        ? { key: column.key, direction: prev.direction === "asc" ? "desc" : "asc" }
        : { key: column.key, direction: column.defaultDirection ?? "desc" },
    );
  };

  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-6">{emptyMessage}</p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b">
            {columns.map((column) => {
              const isSortable = column.sortable !== false;
              const isActive = sort.key === column.key;
              const alignRight = column.align === "right";
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={
                    isActive
                      ? sort.direction === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                  className={cn(
                    "py-2 px-2 font-medium text-muted-foreground whitespace-nowrap",
                    alignRight ? "text-right" : "text-left",
                    column.className,
                  )}
                >
                  {isSortable ? (
                    <button
                      type="button"
                      onClick={() => toggle(column)}
                      aria-label={`Ordenar por ${column.header}`}
                      className={cn(
                        "inline-flex items-center gap-1 h-10 rounded px-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        alignRight && "flex-row-reverse",
                        isActive && "text-foreground",
                      )}
                    >
                      {column.header}
                      {isActive ? (
                        sort.direction === "asc" ? (
                          <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : (
                          <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                        )
                      ) : (
                        <ChevronsUpDown
                          className="h-3.5 w-3.5 opacity-40"
                          aria-hidden="true"
                        />
                      )}
                    </button>
                  ) : (
                    <span className="inline-flex items-center h-10 px-1">{column.header}</span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row, index) => (
            <tr key={rowKey(row, index)} className="border-b last:border-0 hover:bg-muted/40">
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    "py-2 px-2 align-top",
                    column.align === "right" ? "text-right tabular-nums" : "text-left",
                    column.className,
                  )}
                >
                  {column.cell ? column.cell(row) : column.value(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && <tfoot className="border-t-2">{footer}</tfoot>}
      </table>
    </div>
  );
}
