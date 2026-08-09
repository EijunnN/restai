"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { motion, AnimatePresence } from "motion/react";
import { ArrowLeft, AlertCircle, ShoppingBag } from "lucide-react";
import { useCartStore } from "@/stores/cart-store";
import { useCustomerStore } from "@/stores/customer-store";
import { useVoiceAgent, type VoiceCatalogEntry } from "@/hooks/use-voice-agent";
import { useWakeLock, useIdleTimeout } from "@/hooks/use-kiosk";
import {
  createVoiceTools,
  type VoiceMenuItem,
  type ModifierGroup,
} from "@/lib/voice-tools";
import { fraunces } from "./_components/fonts";
import { glassChip } from "./_components/glass";
import { DishStage } from "./_components/dish-stage";
import { VoicePresence } from "./_components/voice-presence";
import { LiveCaption } from "./_components/live-caption";
import { OrderRail } from "./_components/order-rail";
import { ModifierPanel } from "./_components/modifier-panel";
import { OrderSentOverlay } from "./_components/order-sent-overlay";

/**
 * Mesero por voz — pantalla de tablet.
 *
 * Vive dentro del grupo `(customer)`, cuyo layout está pensado para el móvil del
 * comensal (`max-w-lg` y cabecera). Esta pantalla es lo contrario: ocupa la
 * tablet entera, así que se saca del flujo con `fixed inset-0`. Aquí no hay
 * navegación ni marca; solo la comida y la conversación.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
const DEFAULT_TAX_RATE = 1800;

/**
 * Silencio tras el cual se cuelga la llamada.
 *
 * Una conexión de voz abierta se cobra por minuto, y el caso real es el comensal
 * que termina de pedir y sigue charlando con su mesa delante del micro.
 */
const IDLE_HANGUP_MS = 3 * 60 * 1000;

interface MenuPayload {
  branch: { id: string; name: string; currency: string; tax_rate?: number };
  table: { id: string; number: number };
  items: VoiceMenuItem[];
}

export default function VoiceOrderPage({
  params,
}: {
  params: Promise<{ branchSlug: string; tableCode: string }>;
}) {
  const { branchSlug, tableCode } = use(params);
  const router = useRouter();

  const token = useCustomerStore((s) => s.token);
  const cartItems = useCartStore((s) => s.items);
  const getTotal = useCartStore((s) => s.getTotal);

  const [menu, setMenu] = useState<MenuPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  const [stageIds, setStageIds] = useState<string[]>([]);
  const [stageTitle, setStageTitle] = useState<string | undefined>();
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [placedOrder, setPlacedOrder] = useState<{ id: string; orderNumber: string } | null>(null);
  const [catalog, setCatalog] = useState<VoiceCatalogEntry[]>([]);
  const [options, setOptions] = useState<{ groups: ModifierGroup[]; chosen: string[] } | null>(
    null,
  );

  const taxRate = menu?.branch.tax_rate ?? DEFAULT_TAX_RATE;

  useEffect(() => {
    void fetch(`${API_URL}/api/customer/${branchSlug}/${tableCode}/menu`)
      .then((res) => res.json())
      .then((result) => {
        if (!result.success) {
          setLoadError(result.error?.message || "No pudimos cargar la carta.");
          return;
        }
        setMenu(result.data);
      })
      .catch(() => setLoadError("No hay conexión con el restaurante."));
  }, [branchSlug, tableCode]);

  const itemById = useMemo(
    () => new Map((menu?.items ?? []).map((item) => [item.id, item])),
    [menu],
  );

  /** Fotos por plato, para las miniaturas del pedido. */
  const imageById = useMemo(
    () => new Map((menu?.items ?? []).map((item) => [item.id, item.image_url])),
    [menu],
  );

  const executeTool = useMemo(() => {
    if (!menu || !token || catalog.length === 0) return null;
    return createVoiceTools({
      catalog,
      menuItems: menu.items,
      branchSlug,
      token,
      taxRate,
      visuals: {
        showItems: (ids, title) => {
          setStageTitle(title);
          setStageIds(ids);
          // El primero de la tanda pasa a ser el héroe: la pantalla nunca se
          // queda esperando a que el mesero enfoque algo.
          setFocusedId(ids[0] ?? null);
        },
        focusItem: (id) => {
          setStageIds((prev) => (prev.includes(id) ? prev : [id, ...prev]));
          setFocusedId(id);
        },
        showOptions: (_itemId, groups) => setOptions({ groups, chosen: [] }),
        resolveOptions: (chosen) => {
          // Se marcan las elegidas y el panel se retira un segundo después: sin
          // esa pausa, el comensal no llega a ver confirmado lo que acaba de
          // decir y se queda con la duda.
          setOptions((prev) => (prev ? { ...prev, chosen } : null));
          setTimeout(() => setOptions(null), 1400);
        },
      },
      onOrderPlaced: (order) => {
        setPlacedOrder(order);
        setStageIds([]);
        setFocusedId(null);
        setStageTitle(undefined);
        setOptions(null);
      },
    });
  }, [menu, token, branchSlug, taxRate, catalog]);

  const handleToolCall = useCallback(
    async (name: string, args: Record<string, unknown>) => {
      if (!executeTool) return { error: "La carta todavía no terminó de cargar." };
      return executeTool(name, args);
    },
    [executeTool],
  );

  const handleCatalog = useCallback((entries: VoiceCatalogEntry[]) => {
    setCatalog(entries);
  }, []);

  const { state, transcript, userTranscript, error, outputLevel, connect, disconnect } =
    useVoiceAgent({
    token,
      onToolCall: handleToolCall,
      onCatalog: handleCatalog,
    });

  /**
   * Elegir una opción con el dedo.
   *
   * La voz sigue mandando, pero en un comedor ruidoso —o con un nombre que el
   * modelo no coge a la primera— repetir tres veces "bien dorado" es peor que
   * tocarlo. La marca en pantalla es la misma que al decirlo.
   */
  const handleChooseOption = useCallback((_groupId: string, name: string) => {
    setOptions((prev) => {
      if (!prev) return prev;
      const yaEsta = prev.chosen.some((c) => c.toLowerCase() === name.toLowerCase());
      return { ...prev, chosen: yaEsta ? prev.chosen : [...prev.chosen, name] };
    });
  }, []);

  const stageItems = useMemo(
    () => stageIds.map((id) => itemById.get(id)).filter(Boolean) as VoiceMenuItem[],
    [stageIds, itemById],
  );

  useWakeLock(started);

  /**
   * Al colgar por silencio, DECIRLO.
   *
   * Antes la conversación se evaporaba y la pantalla volvía a la portada sin
   * explicación: el comensal que se giró a hablar con la mesa volvía y creía
   * que se había roto. El pedido no se pierde —vive en el carrito— y eso
   * también hay que decirlo.
   */
  const [hungUpByIdle, setHungUpByIdle] = useState(false);

  const { reset: resetIdle } = useIdleTimeout(
    IDLE_HANGUP_MS,
    () => {
      disconnect();
      setStarted(false);
      setStageIds([]);
      setFocusedId(null);
      setStageTitle(undefined);
      setHungUpByIdle(true);
    },
    started && state !== "error",
  );

  // Hablar cuenta como actividad. Sin esto el temporizador solo miraría el
  // cristal y colgaría en mitad de una conversación en la que nadie ha tocado
  // la pantalla, que es justo el uso que buscamos.
  useEffect(() => {
    if (state === "listening" || state === "speaking" || state === "thinking") {
      resetIdle();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, transcript]);

  async function handleStart() {
    setStarted(true);
    await connect();
  }

  function handleExit() {
    disconnect();
    router.push(`/${branchSlug}/${tableCode}/menu`);
  }

  if (!token) {
    return (
      <Shell>
        <Centered>
          <AlertCircle className="mx-auto h-10 w-10 text-[var(--hueso)]/25" />
          <p className="mt-5 text-xl text-[var(--hueso)]/70">
            Escanea el QR de tu mesa para empezar
          </p>
          <button
            type="button"
            onClick={() => router.push(`/${branchSlug}/${tableCode}`)}
            className="mt-7 rounded-full border border-[var(--hueso)]/25 px-8 py-3 text-[var(--hueso)] transition-colors hover:bg-[var(--hueso)]/10"
          >
            Ir al inicio
          </button>
        </Centered>
      </Shell>
    );
  }

  if (loadError) {
    return (
      <Shell>
        <Centered>
          <AlertCircle className="mx-auto h-10 w-10 text-[var(--rocoto)]" />
          <p className="mt-5 text-xl text-[var(--hueso)]/70">{loadError}</p>
        </Centered>
      </Shell>
    );
  }

  return (
    <Shell>
      <AnimatePresence mode="wait">
        {!started ? (
          <WelcomeGate
            key="gate"
            branchName={menu?.branch.name}
            items={menu?.items ?? []}
            onStart={handleStart}
            resumedAfterIdle={hungUpByIdle}
          />
        ) : (
          <motion.div
            key="live"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8 }}
            className="absolute inset-0"
          >
            {stageItems.length > 0 ? (
              <DishStage
                items={stageItems}
                focusedId={focusedId}
                title={stageTitle}
                onSelect={setFocusedId}
              />
            ) : (
              <EmptyStage branchName={menu?.branch.name} />
            )}

            {/* Subtítulos, abajo a la izquierda: donde el cine pone la voz en
                off y donde no tapan el plato. Se apartan cuando el panel de
                opciones ocupa ese sitio — dos cosas compitiendo por la misma
                esquina se leen como un fallo de maquetación. */}
            <AnimatePresence>
              {!options && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0, transition: { duration: 0.25 } }}
                  className="absolute bottom-[9%] left-[6vw] right-[30vw] space-y-3"
                >
                  {/* Lo que dijo el comensal, encima y más tenue: sin esta línea
                      solo se veía la respuesta del mesero, que puede sonar
                      correcta sin haber entendido bien. Ver la propia frase
                      escrita es la única prueba de que se le entendió. */}
                  {userTranscript && (
                    <p className="text-[0.95rem] leading-snug text-[var(--hueso)]/45">
                      <span className="mr-2 text-[0.62rem] uppercase tracking-[0.28em] text-[var(--aji)]">
                        Dijiste
                      </span>
                      {userTranscript}
                    </p>
                  )}
                  <LiveCaption transcript={transcript} />
                </motion.div>
              )}
            </AnimatePresence>

            <ModifierPanel
              groups={options?.groups ?? []}
              chosen={options?.chosen ?? []}
              visible={Boolean(options)}
              /* La pregunta del mesero viaja CON las opciones: antes se ocultaba
                 al abrirse el panel y el comensal veía una lista sin saber qué
                 le estaban preguntando. */
              question={transcript}
              onChoose={handleChooseOption}
            />

            <VoicePresence state={state} level={outputLevel} />

            {/* Los controles flotan sobre la foto con el mismo cristal que el
                resto: como texto suelto se perdían sobre las imágenes claras. */}
            <button
              type="button"
              onClick={handleExit}
              className="absolute left-[6vw] top-8 z-30 flex items-center gap-2 rounded-full px-4 py-2.5 text-sm text-[var(--hueso)]/75 transition-colors hover:text-[var(--hueso)]"
              style={glassChip}
            >
              <ArrowLeft className="h-4 w-4" />
              Ver la carta
            </button>

            <OrderRail
              items={cartItems}
              total={getTotal(taxRate)}
              imageById={imageById}
              idleHint="Se cuelga sola tras 3 min en silencio"
            />

            {state === "error" && error && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="absolute inset-x-0 bottom-[9%] flex flex-col items-center gap-4"
              >
                <p className="text-[var(--rocoto)]">{error}</p>
                <button
                  type="button"
                  onClick={() => void connect()}
                  className="rounded-full border border-[var(--hueso)]/25 px-8 py-3 text-[var(--hueso)] transition-colors hover:bg-[var(--hueso)]/10"
                >
                  Reintentar
                </button>
              </motion.div>
            )}

            {cartItems.length > 0 && (
              <button
                type="button"
                onClick={() => router.push(`/${branchSlug}/${tableCode}/cart`)}
                className="absolute bottom-7 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full px-4 py-2 text-xs text-[var(--hueso)]/60 transition-colors hover:text-[var(--hueso)]"
                style={glassChip}
              >
                <ShoppingBag className="h-3.5 w-3.5" />
                Prefiero revisarlo yo
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <OrderSentOverlay
        order={placedOrder}
        token={token}
        onDismiss={() => setPlacedOrder(null)}
        onCancelled={() => setPlacedOrder(null)}
      />
    </Shell>
  );
}

/**
 * Lienzo a pantalla completa.
 *
 * El fondo es un carbón CÁLIDO (#14100E), no el gris azulado de costumbre: bajo
 * una foto de comida, un negro frío apaga los amarillos y los rojos, que es
 * justo lo que tiene que brillar aquí. Los colores salen de la cocina peruana
 * —ají amarillo, rocoto, loza— y no de una paleta de plantilla.
 */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className={`${fraunces.variable} fixed inset-0 z-[60] overflow-hidden bg-[var(--carbon)]`}
      style={
        {
          "--carbon": "#14100E",
          "--ceniza": "#26201C",
          "--aji": "#F2A71B",
          "--hueso": "#F7F1E8",
          "--rocoto": "#E0543A",
        } as React.CSSProperties
      }
    >
      {children}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="grid h-full w-full place-items-center text-center">{children}</div>;
}

/** Sin platos en pantalla: color y tipografía, nunca un vacío negro. */
function EmptyStage({ branchName }: { branchName?: string }) {
  return (
    <div className="absolute inset-0">
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 35%, rgba(242,167,27,0.13), transparent 62%)",
        }}
      />
      <div className="absolute inset-x-0 top-[16%] px-[6vw]">
        <h2
          className="font-display max-w-[12ch] text-[clamp(2.5rem,6.5vw,5.5rem)] font-light leading-[0.95] text-[var(--hueso)]/25"
          style={{ fontVariationSettings: "'SOFT' 40, 'WONK' 1, 'opsz' 144" }}
        >
          {branchName ?? "La carta"}
        </h2>
      </div>
    </div>
  );
}

/**
 * Entrada.
 *
 * No es decorativa: el navegador exige un gesto del usuario antes de reproducir
 * audio y de pedir el micrófono. Ese requisito se convierte en el plano de
 * apertura — un plato a pantalla completa, porque lo primero que tiene que pasar
 * aquí es que entre hambre.
 */
function WelcomeGate({
  branchName,
  items,
  onStart,
  resumedAfterIdle,
}: {
  branchName?: string;
  items: VoiceMenuItem[];
  onStart: () => void;
  /** Se volvió aquí porque la llamada se cortó sola, no porque nadie lo pidiera. */
  resumedAfterIdle?: boolean;
}) {
  // El plato de portada es siempre el mismo para una carta dada (el primero
  // disponible con foto): la pantalla de bienvenida de un local no debe cambiar
  // en cada recarga, es su escaparate.
  const cover = items.find((item) => item.image_url && item.is_available) ?? items[0];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.5 } }}
      transition={{ duration: 0.9 }}
      className="absolute inset-0"
    >
      {cover?.image_url && (
        <motion.div
          className="absolute inset-0"
          initial={{ scale: 1.12 }}
          animate={{ scale: 1 }}
          transition={{ duration: 2.4, ease: [0.16, 1, 0.3, 1] }}
        >
          <Image
            src={cover.image_url}
            alt=""
            fill
            unoptimized
            priority
            sizes="100vw"
            className="object-cover"
          />
        </motion.div>
      )}

      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to top, rgba(20,16,14,0.97) 4%, rgba(20,16,14,0.55) 42%, rgba(20,16,14,0.25) 100%)",
        }}
      />

      <div className="absolute inset-x-0 bottom-[12%] px-[6vw]">
        <motion.p
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.8 }}
          className="mb-4 text-[0.7rem] uppercase tracking-[0.4em] text-[var(--aji)]"
        >
          {branchName ?? "Bienvenido"}
        </motion.p>

        <motion.h1
          initial={{ opacity: 0, y: 26 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.65, duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          className="font-display max-w-[11ch] text-[clamp(3rem,9vw,7.5rem)] font-light leading-[0.9] tracking-[-0.025em] text-[var(--hueso)]"
          style={{ fontVariationSettings: "'SOFT' 40, 'WONK' 1, 'opsz' 144" }}
        >
          {resumedAfterIdle ? "¿Seguimos?" : "Pide como si hablaras con el mozo"}
        </motion.h1>

        {/* Volver aquí sin explicación se lee como una avería. Y lo que ya se
            había pedido no se pierde: sigue en el carrito. */}
        {resumedAfterIdle && (
          <motion.p
            role="status"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8, duration: 0.7 }}
            className="mt-5 max-w-[36ch] text-[1rem] leading-snug text-[var(--hueso)]/55"
          >
            La llamada se cortó tras unos minutos en silencio. Lo que ya habías
            pedido sigue guardado.
          </motion.p>
        )}

        <motion.button
          type="button"
          onClick={onStart}
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.9, duration: 0.7 }}
          whileTap={{ scale: 0.98 }}
          className="group mt-10 inline-flex items-center gap-4 border-b border-[var(--aji)] pb-2 text-lg text-[var(--hueso)] transition-colors hover:text-[var(--aji)]"
        >
          Toca y empieza a hablar
          <motion.span
            aria-hidden="true"
            className="text-[var(--aji)]"
            animate={{ x: [0, 6, 0] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
          >
            →
          </motion.span>
        </motion.button>
      </div>
    </motion.div>
  );
}
