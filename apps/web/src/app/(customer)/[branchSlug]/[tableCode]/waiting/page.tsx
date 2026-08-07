"use client";
/* eslint-disable react-hooks/todo, react-hooks/set-state-in-effect */

import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@restai/ui/components/card";
import { Button } from "@restai/ui/components/button";
import {
  AlertCircle,
  Bell,
  CheckCircle2,
  Clock,
  Loader2,
  RefreshCcw,
  TimerOff,
  XCircle,
} from "lucide-react";
import { useCustomerStore } from "@/stores/customer-store";
import { useWebSocket } from "@/hooks/use-websocket";
import { useTableAction } from "@/hooks/use-table-action";
import { cn } from "@/lib/utils";
import type { WsMessage } from "@restai/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
const POLL_MS = 5000;

type SessionStatus = "pending" | "active" | "rejected" | "completed";

interface SessionStatusData {
  status: SessionStatus;
  waiting_seconds: number;
  expires_at: string | null;
  expires_in_seconds: number | null;
}

/** "2 min 05 s", "45 s", "1 h 12 min". Sin decimales ni relojes de precisión. */
function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;

  if (hours > 0) {
    return `${hours} h ${String(minutes).padStart(2, "0")} min`;
  }
  if (minutes > 0) {
    return `${minutes} min ${String(rest).padStart(2, "0")} s`;
  }
  return `${rest} s`;
}

export default function WaitingPage({
  params,
}: {
  params: Promise<{ branchSlug: string; tableCode: string }>;
}) {
  "use no memo";
  const { branchSlug, tableCode } = use(params);
  const router = useRouter();
  const sessionId = useCustomerStore((s) => s.sessionId);
  const token = useCustomerStore((s) => s.token);

  const [status, setStatus] = useState<SessionStatus>("pending");
  const [snapshot, setSnapshot] = useState<{
    waitingSeconds: number;
    expiresInSeconds: number | null;
    /** Date.now() del momento en que el servidor nos dio estas cifras. */
    syncedAt: number;
  } | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Distinguir "el mozo dijo que no" de "se agotó el tiempo": el servidor manda
  // "rejected" en ambos casos, pero la explicación que merece el comensal (y lo
  // que debe hacer a continuación) es distinta.
  const [rejectedByStaff, setRejectedByStaff] = useState(false);

  const { send, pendingAction, remainingSeconds, notice } = useTableAction(
    branchSlug,
    tableCode,
    {
      inactiveSessionMessage:
        "Tu mesa ya figura en la pantalla del personal. Si nadie llega, muéstrale esta pantalla al mozo.",
    },
  );

  const pollSessionStatus = useCallback(async () => {
    if (!sessionId) return;
    try {
      const res = await fetch(
        `${API_URL}/api/customer/${branchSlug}/${tableCode}/session-status/${sessionId}`,
      );
      const result = await res.json();

      if (!result?.success) {
        setPollError(
          result?.error?.message ||
            "No pudimos consultar el estado de tu mesa. Reintenta en un momento.",
        );
        return;
      }

      const data = result.data as SessionStatusData;
      setPollError(null);
      setStatus(data.status);
      setSnapshot({
        waitingSeconds: data.waiting_seconds ?? 0,
        expiresInSeconds: data.expires_in_seconds ?? null,
        syncedAt: Date.now(),
      });

      if (data.status === "active") {
        router.replace(`/${branchSlug}/${tableCode}/menu`);
      }
    } catch {
      setPollError("Sin conexión con el restaurante. Revisa tu red.");
    }
  }, [sessionId, branchSlug, tableCode, router]);

  useWebSocket(
    sessionId ? [`session:${sessionId}`] : [],
    (msg: WsMessage) => {
      if (msg.type === "auth:success") {
        void pollSessionStatus();
      } else if (msg.type === "session:approved") {
        setStatus("active");
        router.replace(`/${branchSlug}/${tableCode}/menu`);
      } else if (msg.type === "session:rejected") {
        setRejectedByStaff(true);
        setStatus("rejected");
      }
    },
    token || undefined,
  );

  useEffect(() => {
    if (!sessionId) return;
    void pollSessionStatus();
    const interval = setInterval(() => void pollSessionStatus(), POLL_MS);
    return () => clearInterval(interval);
  }, [sessionId, pollSessionStatus]);

  // Reloj local de 1 s: el contador avanza de verdad entre sondeos, que es lo
  // que convierte una espera en algo tolerable en vez de una ruedita muda.
  useEffect(() => {
    if (status !== "pending") return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [status]);

  if (!sessionId) {
    return (
      <div className="p-4 mt-8">
        <Card>
          <CardContent className="py-10 text-center">
            <AlertCircle className="mx-auto mb-4 h-12 w-12 text-muted-foreground" />
            <h2 className="mb-2 text-lg font-bold">No encontramos tu solicitud</h2>
            <p className="mb-6 text-sm text-muted-foreground">
              Es posible que hayas cerrado la pestaña o que la sesión se haya reiniciado.
              Vuelve a empezar desde la mesa.
            </p>
            <Button
              className="h-11 w-full"
              onClick={() => router.replace(`/${branchSlug}/${tableCode}`)}
            >
              Volver al inicio
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const elapsedSinceSync = snapshot ? Math.max(0, (now - snapshot.syncedAt) / 1000) : 0;
  const waitedSeconds = snapshot ? snapshot.waitingSeconds + elapsedSinceSync : null;
  const remainingTtlSeconds =
    snapshot && snapshot.expiresInSeconds !== null
      ? Math.max(0, snapshot.expiresInSeconds - elapsedSinceSync)
      : null;

  // El servidor manda "rejected" tanto si el mozo dijo que no como si la
  // solicitud caducó. Se distingue con dos señales: un `session:rejected` por
  // tiempo real (rechazo a mano) o una ventana ya agotada (caducidad). Sin
  // ninguna de las dos se usa el mensaje neutro.
  const expiredByTimeout =
    status === "rejected" &&
    !rejectedByStaff &&
    snapshot !== null &&
    snapshot.expiresInSeconds !== null &&
    remainingTtlSeconds !== null &&
    remainingTtlSeconds <= 0;

  if (status === "rejected") {
    return (
      <div className="p-4 mt-8">
        <Card>
          <CardContent className="py-10 text-center">
            {expiredByTimeout ? (
              <TimerOff className="mx-auto mb-4 h-14 w-14 text-amber-500" />
            ) : (
              <XCircle className="mx-auto mb-4 h-14 w-14 text-destructive" />
            )}
            <h2 className="mb-2 text-xl font-bold">
              {expiredByTimeout ? "Se agotó el tiempo de espera" : "No pudimos abrir tu mesa"}
            </h2>
            <p className="mb-6 text-sm text-muted-foreground">
              {expiredByTimeout ? (
                <>
                  Nadie del personal llegó a confirmar tu mesa dentro del plazo, así que la
                  solicitud se cerró sola. No has hecho nada mal: vuelve a intentarlo y, si el
                  local está muy lleno, avisa a un mozo para que la confirme al momento.
                </>
              ) : (
                <>
                  El personal no confirmó esta mesa. Puede que esté reservada o que prefieran
                  tomarte el pedido en persona. Avisa a un mozo y lo resuelven en un momento.
                </>
              )}
            </p>
            <div className="space-y-2">
              <Button
                className="h-11 w-full"
                onClick={() => router.replace(`/${branchSlug}/${tableCode}`)}
              >
                <RefreshCcw className="mr-2 h-4 w-4" />
                Volver a intentarlo
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (status === "completed") {
    return (
      <div className="p-4 mt-8">
        <Card>
          <CardContent className="py-10 text-center">
            <CheckCircle2 className="mx-auto mb-4 h-14 w-14 text-muted-foreground" />
            <h2 className="mb-2 text-xl font-bold">El servicio de esta mesa terminó</h2>
            <p className="mb-6 text-sm text-muted-foreground">
              Esta visita ya se cerró. Si vas a pedir otra vez, vuelve a escanear el código de
              la mesa.
            </p>
            <Button
              className="h-11 w-full"
              onClick={() => router.replace(`/${branchSlug}/${tableCode}`)}
            >
              Empezar de nuevo
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Barra de avance sobre la ventana completa (esperado + restante). Si el
  // servidor no da vencimiento no se inventa ninguna: se omite la barra.
  const ttlWindowSeconds =
    waitedSeconds !== null && remainingTtlSeconds !== null
      ? waitedSeconds + remainingTtlSeconds
      : null;
  const progressPercent =
    ttlWindowSeconds && ttlWindowSeconds > 0 && waitedSeconds !== null
      ? Math.min(100, Math.max(0, (waitedSeconds / ttlWindowSeconds) * 100))
      : null;
  const callWaiterWait = remainingSeconds("call_waiter");

  return (
    <div className="space-y-4 p-4 pt-8">
      <Card>
        <CardContent className="py-8 text-center">
          <div className="relative mx-auto mb-5 h-20 w-20">
            <Clock className="h-20 w-20 text-primary/20" />
            <Loader2 className="absolute left-5 top-5 h-10 w-10 animate-spin text-primary" />
          </div>

          <h2 className="mb-1 text-xl font-bold">Esperando confirmación</h2>
          {/*
            No se pinta `tableCode`: ese segmento de la URL es el qr_code interno
            ("mi-sede-T7-lx8k2a") y en pantalla se leía "la mesa mi-sede-T7-...".
            El número real solo lo sirve la carta, que aquí todavía no se carga.
          */}
          <p className="mb-5 text-sm text-muted-foreground">
            El mozo tiene que confirmar tu mesa antes de que puedas pedir.
          </p>

          {waitedSeconds !== null ? (
            <div className="space-y-3">
              <div>
                <p className="text-3xl font-bold tabular-nums text-foreground">
                  {formatDuration(waitedSeconds)}
                </p>
                <p className="text-xs text-muted-foreground">esperando</p>
              </div>

              {progressPercent !== null && remainingTtlSeconds !== null && (
                <div className="space-y-1.5">
                  <div
                    className="h-2 overflow-hidden rounded-full bg-muted"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(progressPercent)}
                    aria-label="Tiempo restante para que caduque la solicitud"
                  >
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-1000 ease-linear",
                        remainingTtlSeconds <= 60 ? "bg-amber-500" : "bg-primary",
                      )}
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    La solicitud caduca en{" "}
                    <span className="font-medium tabular-nums text-foreground">
                      {formatDuration(remainingTtlSeconds)}
                    </span>
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="mx-auto h-10 w-32 animate-pulse rounded bg-muted" />
          )}
        </CardContent>
      </Card>

      {pollError && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="flex-1">
            <p>{pollError}</p>
            <Button
              variant="outline"
              className="mt-2 h-10"
              onClick={() => void pollSessionStatus()}
            >
              Reintentar
            </Button>
          </div>
        </div>
      )}

      <Button
        variant="outline"
        className="h-12 w-full gap-2"
        disabled={pendingAction !== null || callWaiterWait > 0}
        aria-label={
          callWaiterWait > 0
            ? `Avisar al mozo. Disponible en ${callWaiterWait} segundos`
            : "Avisar al mozo"
        }
        onClick={() => void send("call_waiter")}
      >
        {pendingAction === "call_waiter" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Bell className="h-4 w-4" />
        )}
        {pendingAction === "call_waiter"
          ? "Avisando..."
          : callWaiterWait > 0
            ? `Espera ${callWaiterWait} s`
            : "Avisar al mozo"}
      </Button>

      {notice && (
        <div
          role={notice.kind === "error" ? "alert" : "status"}
          className={cn(
            "rounded-lg border px-3 py-2 text-sm",
            notice.kind === "success" &&
              "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300",
            notice.kind === "info" && "border-primary/30 bg-primary/10 text-foreground",
            notice.kind === "error" && "border-destructive/40 bg-destructive/10 text-destructive",
          )}
        >
          {notice.message}
        </div>
      )}

      <p className="px-2 text-center text-xs text-muted-foreground">
        Deja esta pantalla abierta: entrarás a la carta en cuanto el mozo confirme.
      </p>
    </div>
  );
}
