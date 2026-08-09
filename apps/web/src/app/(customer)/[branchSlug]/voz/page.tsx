"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import { Delete, Loader2, AlertCircle } from "lucide-react";
import { useWakeLock, KIOSK_INTENT_KEY } from "@/hooks/use-kiosk";
import { fraunces } from "../[tableCode]/voz/_components/fonts";

/**
 * Tablet de pared: la que no sabe en qué mesa está.
 *
 * ── Por qué la mesa se teclea y no se pide hablando ──────────────────────────
 * Sería más bonito que el agente preguntara "¿en qué mesa estás?", pero crea un
 * círculo: la credencial de voz se acuña contra una sesión de mesa, y la sesión
 * necesita la mesa. Romperlo obligaría a exponer un endpoint de voz SIN
 * autenticar, es decir, un botón público que gasta dinero de la cuenta del
 * local; cualquiera en la calle podría dejarlo hablando solo.
 *
 * Así que la mesa se teclea una vez —cinco caracteres, en un teclado del tamaño
 * de la palma de la mano— y a partir de ahí ya no se vuelve a tocar la pantalla.
 *
 * A partir del código, el flujo es EXACTAMENTE el del QR: se resuelve la mesa
 * con el endpoint público que ya existe y se entra por la misma pantalla de
 * sesión. Esta ruta no duplica nada de la lógica de sesión.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

const KEYS = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["0", "", "⌫"],
];

export default function WallTabletPage({
  params,
}: {
  params: Promise<{ branchSlug: string }>;
}) {
  const { branchSlug } = use(params);
  const router = useRouter();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useWakeLock();

  const canSubmit = code.length >= 4 && !loading;

  function press(key: string) {
    if (loading) return;
    setError(null);
    if (key === "⌫") {
      setCode((prev) => prev.slice(0, -1));
      return;
    }
    if (!key) return;
    setCode((prev) => (prev.length >= 8 ? prev : prev + key));
  }

  function submit() {
    if (!canSubmit) return;
    setLoading(true);
    setError(null);

    const normalized = code.trim().toUpperCase().replace(/[\s\-_.]/g, "");
    void fetch(
      `${API_URL}/api/customer/${encodeURIComponent(branchSlug)}/tables/by-code/${encodeURIComponent(normalized)}`,
    )
      .then((res) => res.json())
      .then((result) => {
        const qrCode = result?.data?.table?.qr_code;
        if (!result.success || !qrCode) {
          setError(result.error?.message ?? "No encontramos esa mesa. Revisa el código.");
          setCode("");
          setLoading(false);
          return;
        }
        // La intención sobrevive al flujo de sesión (registro y, si el local lo
        // exige, aprobación del mozo). Cuando el comensal llegue a la carta, la
        // pantalla la consumirá y saltará a la conversación.
        sessionStorage.setItem(KIOSK_INTENT_KEY, "1");
        router.replace(`/${branchSlug}/${qrCode}`);
      })
      .catch(() => {
        setError("No pudimos conectar. Avisa al personal.");
        setLoading(false);
      });
  }

  return (
    <div
      className={`${fraunces.variable} fixed inset-0 z-[60] overflow-hidden bg-[#14100E]`}
      style={{ "--aji": "#F2A71B", "--hueso": "#F7F1E8" } as React.CSSProperties}
    >
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_25%,rgba(242,167,27,0.12),transparent_62%)]" />

      <div className="relative grid h-full w-full place-items-center">
        <div className="flex flex-col items-center gap-8">
          <div className="text-center">
            <p className="mb-4 text-[0.7rem] uppercase tracking-[0.4em] text-[var(--aji)]">
              Pedir hablando
            </p>
            <h1
              className="font-display text-[clamp(2.5rem,7vw,5rem)] font-light leading-[0.95] tracking-[-0.02em] text-[var(--hueso)]"
              style={{ fontVariationSettings: "'SOFT' 40, 'WONK' 1, 'opsz' 144" }}
            >
              ¿En qué mesa estás?
            </h1>
            <p className="mt-4 text-lg font-light text-[var(--hueso)]/45">
              El código está en el cartel de tu mesa
            </p>
          </div>

          {/* Casillas del código: llenarlas es un progreso visible, y eso hace
              que teclear no se sienta como un trámite. */}
          <div className="flex h-16 items-center gap-3">
            {Array.from({ length: Math.max(5, code.length) }).map((_, i) => (
              <motion.div
                key={i}
                animate={{
                  borderColor: code[i] ? "var(--aji)" : "rgba(247,241,232,0.18)",
                  scale: code.length - 1 === i ? [1.12, 1] : 1,
                }}
                transition={{ type: "spring", stiffness: 420, damping: 22 }}
                className="grid h-16 w-14 place-items-center rounded-sm border-b-2 text-3xl font-light text-[var(--hueso)]"
              >
                {code[i] ?? ""}
              </motion.div>
            ))}
          </div>

          <AnimatePresence>
            {error && (
              <motion.p
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-2 text-[#E0543A]"
              >
                <AlertCircle className="h-4 w-4" />
                {error}
              </motion.p>
            )}
          </AnimatePresence>

          <div className="grid grid-cols-3 gap-4">
            {KEYS.flat().map((key, index) =>
              key ? (
                <motion.button
                  key={key}
                  type="button"
                  onClick={() => press(key)}
                  whileTap={{ scale: 0.92 }}
                  className="grid h-20 w-24 place-items-center rounded-full border border-[var(--hueso)]/12 text-3xl font-light text-[var(--hueso)] transition-colors hover:border-[var(--aji)]/50 hover:text-[var(--aji)]"
                >
                  {key === "⌫" ? <Delete className="h-7 w-7" /> : key}
                </motion.button>
              ) : (
                <div key={`gap-${index}`} />
              ),
            )}
          </div>

          {/* Muchos códigos cortos llevan letras: el teclado numérico cubre el
              caso frecuente y este campo el resto, sin llenar la pantalla de
              teclas. */}
          <input
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8));
              setError(null);
            }}
            placeholder="¿Tu código tiene letras? Escríbelo aquí"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Código de mesa"
            className="w-80 rounded-full border border-[var(--hueso)]/12 bg-transparent px-5 py-3 text-center text-[var(--hueso)] placeholder:text-[var(--hueso)]/25 outline-none focus:border-[var(--aji)]/60"
          />

          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className="flex items-center gap-3 rounded-full bg-[var(--aji)] px-14 py-5 text-xl font-medium text-[#14100E] transition-transform enabled:hover:scale-[1.02] disabled:opacity-25"
          >
            {loading && <Loader2 className="h-5 w-5 animate-spin" />}
            {loading ? "Buscando tu mesa…" : "Continuar"}
          </button>
        </div>
      </div>
    </div>
  );
}
