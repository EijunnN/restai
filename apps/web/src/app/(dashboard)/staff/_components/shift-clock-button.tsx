"use client";

import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@restai/ui/components/button";
import { LogIn, LogOut } from "lucide-react";
import { toast } from "sonner";
import { useCreateShift, useEndShift } from "@/hooks/use-staff";
import { useAuthStore } from "@/stores/auth-store";
import { hasPermission } from "@/lib/permissions";
import { apiFetch, ApiError } from "@/lib/fetcher";
import { formatDate } from "@/lib/utils";

/**
 * Fichaje de turno para CUALQUIER empleado autenticado.
 *
 * La API ya permite a un mozo o a un cocinero abrir y cerrar su propio turno
 * (POST /api/staff/shifts y PATCH /api/staff/shifts/:id no exigen permiso; la
 * pertenencia se comprueba contra `user.sub`). El problema era de interfaz: el
 * único sitio que ofrecía el fichaje era la pantalla "Personal", que exige
 * `staff:read`, permiso que ni el mozo ni la cocina tienen. Resultado: el
 * backend les dejaba fichar y la aplicación no. Por eso este control vive
 * suelto y se monta también en pantallas que sí pueden abrir (Órdenes).
 *
 * Saber si YA hay un turno abierto tiene dos caminos, porque el listado
 * `GET /api/staff/shifts` sí exige `staff:read`:
 *  - Con `staff:read` (cajero, gerente, administración) se lee del servidor:
 *    es la verdad, y vale desde cualquier dispositivo.
 *  - Sin él (mozo, cocina) se recuerda en este dispositivo el turno que se
 *    abrió desde aquí. Si lo abrió en otra tablet, el servidor responde 409 al
 *    reintentar y se lo explicamos en vez de dejarlo sin pistas.
 */

interface Shift {
  id: string;
  user_id: string;
  start_time: string | null;
  end_time: string | null;
}

interface TurnoRecordado {
  id: string;
  startedAt: string | null;
}

function claveDeAlmacen(userId: string, branchId: string): string {
  return `restai:turno-abierto:${userId}:${branchId}`;
}

function leerTurnoRecordado(userId?: string, branchId?: string | null): TurnoRecordado | null {
  if (!userId || !branchId || typeof window === "undefined") return null;
  try {
    const crudo = window.localStorage.getItem(claveDeAlmacen(userId, branchId));
    if (!crudo) return null;
    const dato = JSON.parse(crudo) as TurnoRecordado;
    return dato && typeof dato.id === "string" ? dato : null;
  } catch {
    // Modo privado o dato corrupto: sin memoria local, pero el botón sigue
    // sirviendo para iniciar turno.
    return null;
  }
}

function guardarTurnoRecordado(
  userId: string | undefined,
  branchId: string | null | undefined,
  turno: TurnoRecordado | null,
): void {
  if (!userId || !branchId || typeof window === "undefined") return;
  try {
    const clave = claveDeAlmacen(userId, branchId);
    if (turno) window.localStorage.setItem(clave, JSON.stringify(turno));
    else window.localStorage.removeItem(clave);
  } catch {
    /* almacenamiento no disponible: no es motivo para romper el fichaje */
  }
}

export function ShiftClockButton() {
  const user = useAuthStore((s) => s.user);
  const branchId = useAuthStore((s) => s.selectedBranchId);
  const puedeListarTurnos = hasPermission(user?.role, "staff:read");
  const qc = useQueryClient();

  // MISMA clave de caché que `useShifts`: quien tenga las dos pantallas abiertas
  // comparte respuesta e invalidaciones, y quien no tenga permiso ni siquiera
  // dispara la consulta (era justo el 403 evitable que había que quitar).
  const { data: turnos } = useQuery<Shift[]>({
    queryKey: ["staff", "shifts"],
    queryFn: () => apiFetch<Shift[]>("/api/staff/shifts"),
    enabled: puedeListarTurnos && !!user,
  });

  const turnoDelServidor =
    turnos?.find((t) => t.user_id === user?.id && !t.end_time) ?? null;

  const [turnoLocal, setTurnoLocal] = useState<TurnoRecordado | null>(null);

  // La lectura del almacenamiento se hace tras montar para no desincronizar el
  // HTML del servidor con el del cliente.
  useEffect(() => {
    setTurnoLocal(leerTurnoRecordado(user?.id, branchId));
  }, [user?.id, branchId]);

  // Cuando el servidor puede responder, su respuesta manda y de paso corrige el
  // recuerdo local (por ejemplo si el encargado cerró el turno por ti).
  useEffect(() => {
    if (!puedeListarTurnos || !turnos) return;
    const recordado: TurnoRecordado | null = turnoDelServidor
      ? { id: turnoDelServidor.id, startedAt: turnoDelServidor.start_time }
      : null;
    guardarTurnoRecordado(user?.id, branchId, recordado);
    setTurnoLocal(recordado);
  }, [puedeListarTurnos, turnos, turnoDelServidor, user?.id, branchId]);

  const createShift = useCreateShift();
  const endShift = useEndShift();

  const turnoAbierto: TurnoRecordado | null = turnoDelServidor
    ? { id: turnoDelServidor.id, startedAt: turnoDelServidor.start_time }
    : turnoLocal;

  const iniciarTurno = useCallback(async () => {
    try {
      const turno = (await createShift.mutateAsync({})) as Shift;
      const recordado: TurnoRecordado | null = turno?.id
        ? { id: turno.id, startedAt: turno.start_time ?? new Date().toISOString() }
        : null;
      if (recordado) {
        guardarTurnoRecordado(user?.id, branchId, recordado);
        setTurnoLocal(recordado);
      }
      toast.success("Turno iniciado");
    } catch (err) {
      const error = err as ApiError;
      if (error?.code === "CONFLICT") {
        // Quien puede listar turnos recupera el suyo con solo releer: así el
        // botón pasa a "Terminar turno" en vez de repetir el mismo choque.
        void qc.invalidateQueries({ queryKey: ["staff", "shifts"] });
        toast.error(
          "Ya tienes un turno abierto en esta sede. Si lo iniciaste en otro dispositivo, ciérralo allí o pídele al encargado que lo cierre.",
        );
        return;
      }
      toast.error(error?.message || "No se pudo iniciar el turno");
    }
  }, [createShift, qc, user?.id, branchId]);

  const terminarTurno = useCallback(async () => {
    if (!turnoAbierto) return;
    try {
      await endShift.mutateAsync(turnoAbierto.id);
      guardarTurnoRecordado(user?.id, branchId, null);
      setTurnoLocal(null);
      toast.success("Turno finalizado");
    } catch (err) {
      const error = err as ApiError;
      // Los tres códigos significan lo mismo desde aquí: ese turno YA NO está
      // abierto. NOT_FOUND (no existe o es de otra sede), BAD_REQUEST (el
      // servidor ya lo tenía cerrado) y CONFLICT (lo cerraron entre nuestra
      // lectura y nuestro UPDATE). Si no se olvidara el recuerdo local, quien no
      // tiene `staff:read` se quedaba con el botón clavado en "Terminar turno"
      // para siempre: cada pulsación volvía a fallar y nunca podía volver a
      // fichar desde este dispositivo.
      const turnoYaCerrado =
        error?.code === "NOT_FOUND" ||
        error?.code === "BAD_REQUEST" ||
        error?.code === "CONFLICT" ||
        // El id recordado no es suyo: tampoco sirve de nada conservarlo.
        error?.code === "FORBIDDEN";
      if (turnoYaCerrado) {
        guardarTurnoRecordado(user?.id, branchId, null);
        setTurnoLocal(null);
        // Con `staff:read` la verdad la manda el servidor: si no se relee, el
        // botón seguiría ofreciendo cerrar un turno que ya está cerrado.
        void qc.invalidateQueries({ queryKey: ["staff", "shifts"] });
        toast.error(
          error.code === "FORBIDDEN"
            ? "Ese turno no es tuyo. Se descartó el registro de este dispositivo."
            : "Ese turno ya no está abierto: lo cerró otra persona o ya estaba cerrado.",
        );
        return;
      }
      toast.error(error?.message || "No se pudo finalizar el turno");
    }
  }, [endShift, qc, turnoAbierto, user?.id, branchId]);

  if (!user) return null;

  if (turnoAbierto) {
    return (
      <Button
        variant="outline"
        className="h-10"
        onClick={terminarTurno}
        disabled={endShift.isPending}
        title={
          turnoAbierto.startedAt
            ? `Turno iniciado el ${formatDate(turnoAbierto.startedAt)}`
            : undefined
        }
      >
        <LogOut className="mr-2 h-4 w-4" />
        {endShift.isPending ? "Cerrando turno..." : "Terminar turno"}
      </Button>
    );
  }

  return (
    <Button
      variant="outline"
      className="h-10"
      onClick={iniciarTurno}
      disabled={createShift.isPending}
    >
      <LogIn className="mr-2 h-4 w-4" />
      {createShift.isPending ? "Fichando..." : "Iniciar turno"}
    </Button>
  );
}
