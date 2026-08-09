"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@restai/ui/components/button";
import { Sheet, SheetContent, SheetTitle } from "@restai/ui/components/sheet";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useAuthStore } from "@/stores/auth-store";
import { hasAllPermissions, hasPermission } from "@/lib/permissions";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useOrders, useUpdateOrderStatus } from "@/hooks/use-orders";
import { useOrgSettings, useBranchSettings } from "@/hooks/use-settings";
import { usePrintReceipt } from "@/components/print-ticket";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { apiFetch } from "@/lib/fetcher";
import { ShiftClockButton } from "../staff/_components/shift-clock-button";
import { PaymentDialog } from "../payments/_components/payment-dialog";
import { OrdersToolbar } from "./_components/orders-toolbar";
import { FilterChips } from "../menu/_components/filter-chips";
import { StageRail } from "./_components/stage-rail";
import { OrdersFeed, type OrdenFila } from "./_components/orders-feed";
import { OrderInspector } from "./_components/order-inspector";
import {
  HistoryPeriods,
  OrdersHistory,
  periodosHistorial,
} from "./_components/orders-history";
import {
  ETIQUETA_ESTADO,
  FILTROS,
  contarFiltros,
  cumpleFiltro,
  type ClaveFiltro,
} from "./_components/orders-flow";

/** A partir de aquí caben las tres columnas: etapas, lista y ficha. */
const TRES_COLUMNAS = "(min-width: 1536px)";

const PAGINA_HISTORIAL = 25;

export default function OrdersPage() {
  const role = useAuthStore((s) => s.user?.role);

  /**
   * Los permisos se comprueban AQUÍ y bajan a cada componente.
   *
   * Antes solo se comprobaba uno —el de cobrar— y el botón de avanzar estado se
   * pintaba a todo el que abriera la pantalla. Funcionaba de casualidad, porque
   * hoy todos los roles con `orders:read` tienen también `orders:update_status`;
   * en cuanto exista un rol de solo lectura, el botón muere en un 403 mudo.
   */
  const puedeAvanzar = hasPermission(role, "orders:update_status");
  const puedeCobrar = hasAllPermissions(role, ["payments:create", "payments:read"]);
  const puedeAnular = hasPermission(role, "orders:update_status");
  const puedeCrear = hasPermission(role, "orders:create");

  const anchoCompleto = useMediaQuery(TRES_COLUMNAS);

  const [vista, setVista] = useState<"curso" | "historial">("curso");
  const [busqueda, setBusqueda] = useState("");
  const [filtro, setFiltro] = useState<ClaveFiltro>("todas");
  const [etapa, setEtapa] = useState<string | null>(null);
  const [periodo, setPeriodo] = useState("7d");
  const [pagina, setPagina] = useState(1);
  const [ordenActivaId, setOrdenActivaId] = useState<string | null>(null);
  const [cobrandoId, setCobrandoId] = useState<string | null>(null);
  const [porAnular, setPorAnular] = useState<OrdenFila | null>(null);

  /*
    Un solo reloj para toda la pantalla.

    Los minutos de espera se calculan contra ESTE valor y no contra `Date.now()`
    en cada fila: si cada una mirase su propio reloj, dos filas de la misma lista
    podrían discrepar en un minuto, y el grupo "necesitan acción" cambiaría de
    contenido a mitad de un render. Se refresca cada 20 segundos, que es la
    resolución que se necesita para contar minutos.
  */
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), 20_000);
    return () => clearInterval(id);
  }, []);

  const periodos = useMemo(() => periodosHistorial(), []);
  const periodoActivo = periodos.find((p) => p.clave === periodo);

  const enCurso = vista === "curso";
  const consulta = useOrders(
    enCurso
      ? { scope: "open", q: busqueda.trim() || undefined, limit: 300 }
      : {
          scope: "closed",
          q: busqueda.trim() || undefined,
          from: periodoActivo?.from,
          to: periodoActivo?.to,
          page: pagina,
          limit: PAGINA_HISTORIAL,
        },
  );

  /*
    Cuántas órdenes hay abiertas AHORA, mire uno lo que mire.

    La pestaña "En curso" lleva ese número también desde el historial, y es
    justo cuando más sirve: te enteras de que el servicio se está acumulando
    mientras revisas comandas de la semana pasada. Pide una sola fila, así que
    lo que cuesta es el COUNT, no traerse la lista.
  */
  const abiertas = useOrders(enCurso ? undefined : { scope: "open", limit: 1 });
  const totalAbiertas = enCurso ? undefined : (abiertas.data?.pagination.total ?? 0);

  const actualizarEstado = useUpdateOrderStatus();
  const { data: orgSettings } = useOrgSettings();
  const { data: branchSettings } = useBranchSettings();
  const imprimirTicket = usePrintReceipt();

  const ordenes: OrdenFila[] = (consulta.data?.orders ?? []) as OrdenFila[];
  const paginacion = consulta.data?.pagination;
  const resumen = consulta.data?.summary;

  const conteoFiltros = useMemo(() => contarFiltros(ordenes, ahora), [ordenes, ahora]);

  const visibles = useMemo(
    () =>
      ordenes
        .filter((o) => cumpleFiltro(o, filtro, ahora))
        .filter((o) => (etapa ? o.status === etapa : true)),
    [ordenes, filtro, etapa, ahora],
  );

  const ordenActiva = ordenes.find((o) => o.id === ordenActivaId) ?? null;
  const cambiandoId = actualizarEstado.isPending
    ? (actualizarEstado.variables?.id ?? null)
    : null;

  const subtitulo = enCurso
    ? `${ordenes.length} ${ordenes.length === 1 ? "orden abierta" : "órdenes abiertas"}`
    : (periodoActivo?.nombre ?? "Historial");

  /**
   * Avanzar o retroceder.
   *
   * El fallo se DICE. Antes `mutate` iba sin `onError`, así que un 409 —que
   * ocurre en cuanto la cocina y el salón tocan la misma comanda— dejaba el
   * botón como estaba y cero explicación: el operador concluía que la app no
   * funciona.
   */
  const mover = (orden: OrdenFila, destino: string) => {
    actualizarEstado.mutate(
      { id: orden.id, status: destino },
      {
        onSuccess: () =>
          toast.success(`${orden.order_number ?? "La orden"} · ${ETIQUETA_ESTADO[destino]}`),
        onError: (err: any) => {
          const conflicto = err?.status === 409;
          toast.error(
            conflicto ? "Alguien la movió antes que tú" : "No se pudo cambiar el estado",
            {
              description: conflicto
                ? "La cocina o el salón acaban de tocar esta orden. Se ha recargado."
                : err?.message,
            },
          );
          consulta.refetch();
        },
      },
    );
  };

  const anular = async () => {
    if (!porAnular) return;
    try {
      await actualizarEstado.mutateAsync({ id: porAnular.id, status: "cancelled" } as any);
      toast.success("Orden anulada", {
        description: "Las líneas no cobradas quedan anuladas y hay traza en la auditoría.",
      });
      if (ordenActivaId === porAnular.id) setOrdenActivaId(null);
    } catch (err: any) {
      // El servidor solo admite anular desde pendiente, confirmada o en cocina:
      // una orden lista o servida ya no se puede tirar por esta vía.
      toast.error("No se pudo anular", {
        description:
          err?.status === 400
            ? "Una orden que ya está lista o servida no se anula: hay que retrocederla primero."
            : err?.message,
      });
    }
    setPorAnular(null);
  };

  const imprimir = async (orden: OrdenFila) => {
    const org = orgSettings as any;
    const branch = branchSettings as any;
    const base = {
      businessName: org?.name || "Restaurante",
      ruc: org?.ruc || org?.settings?.ruc || undefined,
      address: branch?.address || undefined,
      orderNumber: orden.order_number || orden.id,
      createdAt: orden.created_at || new Date().toISOString(),
      subtotal: (orden as any).subtotal ?? 0,
      tax: (orden as any).tax ?? 0,
      total: orden.total ?? 0,
      customerName: orden.customer_name || undefined,
    };

    try {
      const detalle: any = await apiFetch(`/api/orders/${orden.id}`);
      imprimirTicket({
        ...base,
        items: (detalle?.items ?? []).map((i: any) => ({
          name: i.name,
          quantity: i.quantity,
          unit_price: i.unit_price,
          total: i.total,
        })),
      });
    } catch {
      // Antes se imprimía igual con `items: []`: salía papel con importes y sin
      // líneas, y nadie se enteraba de que el detalle no había llegado.
      toast.error("No se pudo leer el detalle de la orden", {
        description: "No se ha impreso nada. Inténtalo de nuevo.",
      });
    }
  };

  if (consulta.error) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-extrabold tracking-tight">Órdenes</h1>
        <div className="flex items-center justify-between rounded-lg border border-destructive/50 bg-destructive/5 p-4">
          <p className="text-sm text-destructive">
            No se pudieron cargar las órdenes: {(consulta.error as Error).message}
          </p>
          <Button variant="outline" size="sm" onClick={() => consulta.refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Reintentar
          </Button>
        </div>
      </div>
    );
  }

  const inspector = ordenActiva ? (
    <OrderInspector
      key={ordenActiva.id}
      orden={ordenActiva}
      ahora={ahora}
      cambiando={cambiandoId === ordenActiva.id}
      puedeAvanzar={puedeAvanzar}
      puedeCobrar={puedeCobrar}
      puedeAnular={puedeAnular}
      onCerrar={() => setOrdenActivaId(null)}
      onAvanzar={mover}
      onCobrar={(o) => setCobrandoId(o.id)}
      onImprimir={imprimir}
      onAnular={setPorAnular}
    />
  ) : (
    <div className="flex h-full items-center justify-center rounded-2xl bg-muted/25 p-6 text-center">
      <p className="max-w-[15rem] text-[12.5px] text-muted-foreground">
        Elige una orden para ver qué se pidió, cobrarla o imprimir su boleta.
      </p>
    </div>
  );

  return (
    <div className="flex h-[calc(100vh-8rem)] min-h-0 flex-col gap-3 md:h-[calc(100vh-4rem)]">
      <OrdersToolbar
        subtitulo={subtitulo}
        vista={vista}
        onVista={(v) => {
          setVista(v);
          setPagina(1);
          setOrdenActivaId(null);
        }}
        totalEnCurso={enCurso ? ordenes.length : (totalAbiertas ?? 0)}
        busqueda={busqueda}
        onBusqueda={(v) => {
          setBusqueda(v);
          setPagina(1);
        }}
        puedeCrear={puedeCrear}
        acciones={<ShiftClockButton />}
      />

      {enCurso && (
        <FilterChips
          filtros={FILTROS}
          activo={filtro}
          conteo={conteoFiltros}
          onCambiar={setFiltro}
          nota="Ordenadas por urgencia, no por hora de entrada"
        />
      )}

      {resumen?.truncated && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-[12px] text-amber-600 dark:text-amber-400">
          Hay más órdenes abiertas de las que caben en una carga. Usa el buscador
          para llegar a la que necesitas.
        </p>
      )}

      <div className="flex min-h-0 flex-1 gap-4">
        <aside className="hidden w-48 shrink-0 lg:block">
          {enCurso ? (
            <StageRail ordenes={ordenes} etapa={etapa} onEtapa={setEtapa} />
          ) : (
            <HistoryPeriods
              periodos={periodos}
              activo={periodo}
              onElegir={(p) => {
                setPeriodo(p);
                setPagina(1);
              }}
              totalPeriodo={resumen?.total_amount ?? 0}
              ordenesPeriodo={paginacion?.total ?? 0}
            />
          )}
        </aside>

        <main className="flex min-h-0 flex-1 flex-col">
          {enCurso ? (
            consulta.isLoading && ordenes.length === 0 ? (
              <div className="flex-1 animate-pulse rounded-2xl bg-muted/40" />
            ) : (
              <OrdersFeed
                ordenes={visibles}
                ordenActivaId={ordenActivaId}
                ahora={ahora}
                cambiandoId={cambiandoId}
                puedeAvanzar={puedeAvanzar}
                puedeCobrar={puedeCobrar}
                onAbrir={setOrdenActivaId}
                onAvanzar={mover}
                onCobrar={(o) => setCobrandoId(o.id)}
              />
            )
          ) : (
            <OrdersHistory
              ordenes={ordenes}
              cargando={consulta.isLoading}
              pagina={paginacion?.page ?? 1}
              totalPaginas={paginacion?.totalPages ?? 1}
              total={paginacion?.total ?? 0}
              onPagina={setPagina}
              onAbrir={setOrdenActivaId}
            />
          )}
        </main>

        {anchoCompleto && <aside className="w-[348px] shrink-0">{inspector}</aside>}
      </div>

      {/* En estrecho la ficha se MONTA solo cuando toca: un Sheet escondido con
          clases deja vivo su fondo y su captura de foco. */}
      {!anchoCompleto && (
        <Sheet
          open={!!ordenActiva}
          onOpenChange={(abierto) => {
            if (!abierto) setOrdenActivaId(null);
          }}
        >
          <SheetContent side="right" className="w-full p-0 sm:max-w-md">
            <SheetTitle className="sr-only">Ficha de la orden</SheetTitle>
            <div className="h-full p-3">{inspector}</div>
          </SheetContent>
        </Sheet>
      )}

      {/* El diálogo se monta SOLO al pulsar "Cobrar": montado siempre, sus hooks
          piden las órdenes con saldo en cada carga y devuelven 403 a cocina, que
          entra aquí sin `payments:read`. */}
      {cobrandoId && (
        <PaymentDialog
          open
          onOpenChange={(v) => {
            if (!v) setCobrandoId(null);
          }}
          preselectedOrderId={cobrandoId}
        />
      )}

      {porAnular && (
        <ConfirmDialog
          open
          onOpenChange={(v) => {
            if (!v) setPorAnular(null);
          }}
          title="Anular la orden"
          description={`Se anulan las líneas no cobradas de ${porAnular.order_number ?? "esta orden"}. Si ya se cobró algo, ese dinero sigue registrado y hay que devolverlo aparte.`}
          onConfirm={anular}
          loading={actualizarEstado.isPending}
        />
      )}
    </div>
  );
}
