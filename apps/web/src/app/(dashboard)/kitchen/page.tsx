"use client";

import { useState } from "react";
import { Button } from "@restai/ui/components/button";
import {
  RefreshCw,
  AlertCircle,
  Volume2,
  VolumeX,
  BookOpen,
  Sun,
  Moon,
  Maximize,
  Minimize,
  Timer,
  Minus,
  Plus,
  TriangleAlert,
  Undo2,
  Layers,
  EyeOff,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@restai/ui/components/select";
import { cn } from "@/lib/utils";
import { hasPermission } from "@/lib/permissions";
import { useAuthStore } from "@/stores/auth-store";
import { useTheme } from "@/hooks/use-theme";
import { useBranches } from "@/hooks/use-settings";
import { KitchenProvider, useKitchenContext } from "./_components/kitchen-context";
import { KanbanBoard } from "./_components/kanban-board";
import { MobileTabs } from "./_components/mobile-tabs";
import { MenuAvailabilityPanel } from "./_components/menu-availability-panel";

function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse bg-muted", className)} />;
}

/**
 * Pantalla completa.
 *
 * Una tablet de pase gana una franja de cabecera entera al quitar el navegador,
 * y esa franja son dos comandas más visibles sin desplazar. Se ofrece solo si el
 * navegador lo soporta.
 */
function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false);

  const toggle = () => {
    const doc = document as any;
    const el = document.documentElement as any;
    if (!document.fullscreenElement && !doc.webkitFullscreenElement) {
      (el.requestFullscreen ?? el.webkitRequestFullscreen)?.call(el);
      setIsFullscreen(true);
    } else {
      (document.exitFullscreen ?? doc.webkitExitFullscreen)?.call(document);
      setIsFullscreen(false);
    }
  };

  return { isFullscreen, toggle };
}

function KitchenContent() {
  const {
    isLoading,
    error,
    refetch,
    soundEnabled,
    toggleSound,
    needsSoundUnlock,
    unlockSound,
    sla,
    setSla,
    lateCount,
    stations,
    station,
    setStation,
    zones,
    zone,
    setZone,
    hiddenCount,
    undo,
    runUndo,
    clock,
  } = useKitchenContext();

  const role = useAuthStore((s) => s.user?.role);
  const selectedBranchId = useAuthStore((s) => s.selectedBranchId);
  const puedeTocarCarta = hasPermission(role, "menu:availability");
  const [cartaAbierta, setCartaAbierta] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen();

  const { data: branches } = useBranches();
  const branchName = (branches ?? []).find((b: any) => b.id === selectedBranchId)?.name ?? "";

  if (error) {
    return (
      <div className="flex h-[calc(100vh-4rem)] flex-col gap-4 p-4">
        <h1 className="text-2xl font-bold">Cocina</h1>
        <div
          role="alert"
          className="flex flex-col gap-3 rounded-xl border border-destructive/50 bg-destructive/5 p-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
            <p className="text-sm text-destructive">
              No se pudieron cargar las comandas: {error.message}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {/*
              Aunque el tablero falle, marcar un plato agotado sigue siendo
              posible y urgente: es otro endpoint. Dejar solo "Reintentar" aquí
              obligaba a llamar al gerente justo cuando la pantalla ya falla.
            */}
            {puedeTocarCarta && (
              <Button variant="outline" className="h-10" onClick={() => setCartaAbierta(true)}>
                <BookOpen className="mr-2 h-4 w-4" />
                Carta
              </Button>
            )}
            <Button variant="outline" className="h-10" onClick={() => refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Reintentar
            </Button>
          </div>
        </div>

        {puedeTocarCarta && (
          <MenuAvailabilityPanel open={cartaAbierta} onOpenChange={setCartaAbierta} />
        )}
      </div>
    );
  }

  return (
    /*
      En escritorio el tablero se come el relleno del layout (`-m-6`) y ocupa
      todo el alto útil: en una tablet de pase, cada franja recuperada son dos
      comandas más sin desplazar. En móvil NO se anula el relleno, porque ahí el
      layout reserva sitio para la barra de navegación inferior y solaparla
      dejaría las acciones bajo el dedo del sistema.
    */
    <div className="relative flex h-[calc(100vh-11rem)] flex-col overflow-hidden rounded-lg border border-border bg-background md:-m-6 md:h-[calc(100vh-3.5rem)] md:rounded-none md:border-0">
      <style>{`
        @keyframes kitchen-flash {
          0%, 100% { box-shadow: 0 0 0 0 rgba(250, 204, 21, 0); }
          25% { box-shadow: 0 0 0 4px rgba(250, 204, 21, 0.6); }
          50% { box-shadow: 0 0 0 0 rgba(250, 204, 21, 0); }
          75% { box-shadow: 0 0 0 4px rgba(250, 204, 21, 0.4); }
        }
        .animate-kitchen-flash { animation: kitchen-flash 1s ease-in-out 2; }
        @keyframes kds-blink { 0%,100% { opacity: 1 } 50% { opacity: .25 } }
        .animate-kds-blink { animation: kds-blink 1.6s ease-in-out infinite }
        @keyframes kds-in { from { opacity: 0; transform: translateY(6px) } to { opacity: 1; transform: none } }
        .animate-kds-in { animation: kds-in .18s ease-out }
        @media (prefers-reduced-motion: reduce) {
          .animate-kds-blink, .animate-kitchen-flash, .animate-kds-in { animation: none }
        }
      `}</style>

      {/* ── Cabecera ───────────────────────────────────────────────────── */}
      <header className="flex h-[60px] flex-none items-center gap-3 border-b border-border bg-card px-4">
        <div className="flex items-baseline gap-2.5">
          <h1 className="text-[24px] font-bold leading-none tracking-[-0.03em] text-foreground">
            Cocina
          </h1>
          {branchName && (
            <span className="hidden text-[12px] text-muted-foreground sm:inline">{branchName}</span>
          )}
        </div>

        {/* El punto latiendo es la única animación permanente: dice "esto se
            actualiza solo", que es justo la duda del cocinero ante una pantalla
            quieta durante dos minutos. */}
        <div className="hidden items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-muted-foreground lg:flex">
          <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-kds-blink" />
          En vivo
        </div>

        <div className="hidden h-6 w-px bg-border lg:block" />

        {/*
          Zona: a qué parte del local sirve ESTA pantalla.

          Solo aparece cuando hay más de un ambiente en marcha; en un local de
          una sola sala sería un control que no decide nada. Se recuerda por
          dispositivo, así que la tablet de la terraza abre ya filtrada.
        */}
        {zones.length > 2 && (
          <div className="hidden items-center gap-1.5 md:flex">
            <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <Select value={zone} onValueChange={setZone}>
              <SelectTrigger
                aria-label="Zona del local que atiende esta pantalla"
                className="h-[30px] w-auto min-w-[9rem] gap-1.5 border-border text-[13px] font-semibold"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {zones.map((z) => (
                  <SelectItem key={z.key} value={z.key}>
                    {z.label} ({z.count})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Estaciones: solo cuando hay más de una categoría en marcha */}
        {stations.length > 2 && (
          <div className="hidden items-center gap-1.5 overflow-x-auto lg:flex">
            <span className="mr-0.5 shrink-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Estación
            </span>
            {stations.map((s) => {
              const active = station === s.key;
              return (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setStation(s.key)}
                  aria-pressed={active}
                  className={cn(
                    "inline-flex h-[30px] shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[13px] font-semibold transition-colors",
                    active
                      ? "border-transparent bg-indigo-600 text-white"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {s.label}
                  <span
                    className={cn(
                      "rounded px-1.5 py-px text-[11px] font-extrabold tabular-nums",
                      active
                        ? "bg-white/20 text-white"
                        : "text-muted-foreground bg-foreground/[0.07] dark:bg-white/[0.07]",
                    )}
                  >
                    {s.count}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <span className="flex-1" />

        {/* Meta de tiempo del pase */}
        <div className="hidden items-center gap-2 rounded-md border border-border px-2.5 py-1 text-[12px] text-muted-foreground sm:flex">
          <Timer className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="hidden md:inline">Meta</span>
          <span className="font-bold tabular-nums text-foreground">{sla} min</span>
          <button
            type="button"
            onClick={() => setSla(sla - 1)}
            aria-label="Reducir la meta de tiempo un minuto"
            className="flex h-5 w-5 items-center justify-center rounded hover:bg-muted hover:text-foreground"
          >
            <Minus className="h-3 w-3" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setSla(sla + 1)}
            aria-label="Aumentar la meta de tiempo un minuto"
            className="flex h-5 w-5 items-center justify-center rounded hover:bg-muted hover:text-foreground"
          >
            <Plus className="h-3 w-3" aria-hidden="true" />
          </button>
        </div>

        {puedeTocarCarta && (
          <button
            type="button"
            onClick={() => setCartaAbierta(true)}
            title="Marcar platos agotados o reponerlos en la carta"
            aria-label="Abrir la carta"
            className="flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <BookOpen className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>
        )}

        <button
          type="button"
          onClick={toggleSound}
          aria-pressed={soundEnabled}
          title={soundEnabled ? "Silenciar avisos" : "Activar avisos sonoros"}
          aria-label={soundEnabled ? "Silenciar avisos" : "Activar avisos sonoros"}
          className="flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {soundEnabled ? (
            <Volume2 className="h-[18px] w-[18px]" aria-hidden="true" />
          ) : (
            <VolumeX className="h-[18px] w-[18px]" aria-hidden="true" />
          )}
        </button>

        <button
          type="button"
          onClick={toggleTheme}
          title={theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
          aria-label={theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
          className="flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {theme === "dark" ? (
            <Sun className="h-[18px] w-[18px]" aria-hidden="true" />
          ) : (
            <Moon className="h-[18px] w-[18px]" aria-hidden="true" />
          )}
        </button>

        <button
          type="button"
          onClick={toggleFullscreen}
          title={isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
          aria-label={isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
          className="hidden h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:flex"
        >
          {isFullscreen ? (
            <Minimize className="h-[18px] w-[18px]" aria-hidden="true" />
          ) : (
            <Maximize className="h-[18px] w-[18px]" aria-hidden="true" />
          )}
        </button>

        <button
          type="button"
          onClick={() => refetch()}
          title="Actualizar el tablero"
          aria-label="Actualizar el tablero"
          className="flex h-9 w-9 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <RefreshCw className="h-[18px] w-[18px]" aria-hidden="true" />
        </button>

        <div className="hidden pl-1 text-[20px] font-bold tabular-nums tracking-[-0.02em] text-foreground md:block">
          {clock}
        </div>
      </header>

      {/*
        Los navegadores bloquean el audio hasta que hay un gesto del usuario.
        Sin este aviso, el KDS parecería tener sonido activado y seguiría mudo:
        peor que no tenerlo, porque la cocina confiaría en un aviso que no suena.
      */}
      {soundEnabled && needsSoundUnlock && (
        <button
          type="button"
          onClick={unlockSound}
          className="flex flex-none items-center justify-center gap-2 border-b border-border bg-amber-500/10 px-4 py-2.5 text-[13px] font-semibold text-amber-700 transition-colors hover:bg-amber-500/20 dark:text-amber-400"
        >
          <VolumeX className="h-4 w-4" aria-hidden="true" />
          Toca aquí para activar el aviso sonoro de comandas nuevas
        </button>
      )}

      {/* Una sola alarma para todo el tablero, en vez de tres columnas latiendo */}
      {lateCount > 0 && (
        <div
          role="status"
          className="flex flex-none items-center gap-2.5 border-b border-border bg-muted/50 px-4 py-2 text-[13px] font-semibold text-foreground"
        >
          <TriangleAlert className="h-4 w-4 shrink-0 text-red-500" aria-hidden="true" />
          <span>
            {lateCount === 1
              ? `1 orden pasó la meta de ${sla} min`
              : `${lateCount} órdenes pasaron la meta de ${sla} min`}
          </span>
          <span className="hidden font-medium text-muted-foreground sm:inline">
            Se muestran primero en cada columna.
          </span>
        </div>
      )}

      {/*
        Filtro activo. Es la contrapartida obligatoria de poder filtrar: una
        pantalla vacía por filtro es indistinguible de "no hay nada que
        cocinar", y ese equívoco deja platos sin salir. Se ve en cualquier
        anchura —incluso donde el selector de zona no cabe— y quita el filtro de
        un toque, para que nadie se quede atrapado en una zona que no puede
        cambiar.
      */}
      {hiddenCount > 0 && (
        <div
          role="status"
          className="flex flex-none items-center gap-2.5 border-b border-border bg-amber-500/10 px-4 py-2 text-[13px] font-semibold text-amber-700 dark:text-amber-400"
        >
          <EyeOff className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            {hiddenCount === 1
              ? "1 comanda oculta por el filtro"
              : `${hiddenCount} comandas ocultas por el filtro`}
          </span>
          <span className="hidden font-medium opacity-80 sm:inline">
            Las está atendiendo otra pantalla.
          </span>
          <button
            type="button"
            onClick={() => {
              setZone("all");
              setStation("all");
            }}
            className="ml-auto shrink-0 rounded-md border border-current px-2.5 py-1 text-[12px] font-bold transition-colors hover:bg-amber-500/20"
          >
            Ver todo
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="grid min-h-0 flex-1 gap-px bg-border md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-full bg-card" />
          ))}
        </div>
      ) : (
        <>
          <MobileTabs />
          <KanbanBoard />
        </>
      )}

      {/*
        Deshacer. Un toque errado en un pase es constante, y hasta ahora costaba
        ir a buscar a alguien con más permisos. La ventana es corta a propósito:
        pasado ese margen la comanda ya siguió su curso y revertirla a ciegas
        sería peor que el error.
      */}
      {undo && (
        <div className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-3.5 rounded-lg border border-border bg-popover py-2.5 pl-4 pr-2.5 shadow-[0_12px_32px_rgba(0,0,0,0.45)] animate-kds-in">
          <span className="text-[13px] font-semibold text-foreground">{undo.label}</span>
          <button
            type="button"
            onClick={runUndo}
            className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-[13px] font-bold text-white transition-colors hover:bg-indigo-700"
          >
            <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
            Deshacer
          </button>
        </div>
      )}

      {puedeTocarCarta && (
        <MenuAvailabilityPanel open={cartaAbierta} onOpenChange={setCartaAbierta} />
      )}
    </div>
  );
}

export default function KitchenPage() {
  return (
    <KitchenProvider>
      <KitchenContent />
    </KitchenProvider>
  );
}
