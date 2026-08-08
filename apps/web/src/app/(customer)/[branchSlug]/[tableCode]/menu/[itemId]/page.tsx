"use client";
/* eslint-disable react-hooks/set-state-in-effect */

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Button } from "@restai/ui/components/button";
import {
  AlertCircle,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Minus,
  NotebookPen,
  Plus,
  UtensilsCrossed,
} from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { useCartStore } from "@/stores/cart-store";
import { DishFacts } from "../_components/dish-facts";
import { AlreadyOrdered } from "../_components/already-ordered";
import { RelatedDishes } from "../_components/related-dishes";
import {
  isSingleChoice,
  isUnsatisfiable,
  maximumAllowed,
  optionsTotal,
  requiredMinimum,
  selectionToCartModifiers,
  toggleOption,
  validateSelection,
  type ModifierGroup,
  type Selection,
} from "@/lib/menu-options";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

interface MenuItem {
  id: string;
  category_id: string;
  name: string;
  description?: string | null;
  price: number;
  image_url?: string | null;
  is_available: boolean;
  preparation_time_min?: number | null;
  allergens?: string[] | null;
  dietary_tags?: string[] | null;
  spice_level?: number | null;
}

/**
 * Ficha de un plato.
 *
 * El rediseño cambia sobre todo CUÁNDO se dice lo que falta. Antes el botón
 * decía "Agregar" pase lo que pase y solo al pulsarlo aparecían los errores;
 * ahora el botón dice lo que hay que hacer —"Elige el término"— y arriba queda
 * un aviso que lleva al grupo pendiente. El grupo obligatorio, además, viene
 * abierto: esconderlo tras un acordeón obligaba a descubrirlo.
 *
 * Y corrige cuatro cosas que dejaban al comensal atascado sin explicación:
 *  - Un grupo NO marcado como obligatorio pero con mínimo también se valida
 *    aquí. Antes se ignoraba y el servidor rechazaba el pedido ENTERO al
 *    confirmar, con un 400 genérico y a dos pantallas de distancia.
 *  - Un grupo de una sola opción y obligatorio ya no se puede vaciar volviendo
 *    a tocar la opción marcada.
 *  - Al llegar al tope de extras se dice; antes el toque no hacía nada.
 *  - Si un grupo obligatorio se quedó sin opciones disponibles, se avisa de que
 *    hay que llamar al mozo en vez de dejar el botón muerto para siempre.
 */
export default function ProductDetailPage({
  params,
}: {
  params: Promise<{ branchSlug: string; tableCode: string; itemId: string }>;
}) {
  "use no memo";
  const { branchSlug, tableCode, itemId } = use(params);
  const router = useRouter();

  const addItem = useCartStore((s) => s.addItem);

  const [menuData, setMenuData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<ModifierGroup[]>([]);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>({});
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");
  const [showNotes, setShowNotes] = useState(false);
  const [atLimitGroup, setAtLimitGroup] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const groupRefs = useRef<Record<string, HTMLElement | null>>({});

  const loadMenu = useCallback(() => {
    setLoading(true);
    setError(null);
    void fetch(`${API_URL}/api/customer/${branchSlug}/${tableCode}/menu`)
      .then((r) => r.json())
      .then((result) => {
        if (!result.success) {
          setError(result.error?.message || "No pudimos cargar la carta");
          return;
        }
        setMenuData(result.data);
      })
      .catch(() =>
        setError("No hay conexión con el restaurante. Revisa tu red e inténtalo de nuevo."),
      )
      .finally(() => setLoading(false));
  }, [branchSlug, tableCode]);

  const loadGroups = useCallback(() => {
    setGroupsError(null);
    void fetch(`${API_URL}/api/customer/${branchSlug}/menu/items/${itemId}/modifiers`)
      .then((r) => r.json())
      .then((result) => {
        if (!result.success) {
          setGroupsError(
            "No pudimos cargar las opciones de este plato. Vuelve a intentarlo antes de agregarlo.",
          );
          return;
        }
        setGroups(result.data ?? []);
      })
      .catch(() =>
        setGroupsError(
          "No pudimos cargar las opciones de este plato. Revisa tu conexión e inténtalo de nuevo.",
        ),
      );
  }, [branchSlug, itemId]);

  useEffect(() => {
    const t = setTimeout(() => loadMenu(), 0);
    return () => clearTimeout(t);
  }, [loadMenu]);

  useEffect(() => {
    const t = setTimeout(() => loadGroups(), 0);
    return () => clearTimeout(t);
  }, [loadGroups]);

  const item: MenuItem | undefined = menuData?.items?.find((i: MenuItem) => i.id === itemId);
  const currency: string | undefined = menuData?.branch?.currency;

  const issues = useMemo(() => validateSelection(groups, selection), [groups, selection]);
  const blocked = issues.some((i) => i.blocked);
  const firstIssue = issues[0];

  const extra = useMemo(() => optionsTotal(groups, selection), [groups, selection]);
  const total = item ? (item.price + extra) * quantity : 0;

  const choose = (group: ModifierGroup, optionId: string) => {
    const result = toggleOption(group, selection, optionId);
    setSelection(result.selection);
    setTouched(true);
    // Al llegar al tope el toque no hace nada, pero decirlo evita que el
    // comensal piense que la pantalla se colgó.
    setAtLimitGroup(result.atLimit ? group.id : null);
  };

  const goToIssue = () => {
    if (!firstIssue) return;
    groupRefs.current[firstIssue.groupId]?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  };

  const add = () => {
    if (!item) return;
    if (issues.length > 0) {
      setTouched(true);
      goToIssue();
      return;
    }
    addItem({
      menuItemId: item.id,
      name: item.name,
      unitPrice: item.price,
      quantity,
      modifiers: selectionToCartModifiers(groups, selection),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    });
    router.push(`/${branchSlug}/${tableCode}/menu`);
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden="true" />
      </div>
    );
  }

  if (error || !menuData || !item) {
    return (
      <div className="mt-12 p-6 text-center">
        <p role="alert" className="mb-3 font-medium text-destructive">
          {error || "No encontramos este plato"}
        </p>
        <Button variant="outline" className="h-11" onClick={() => router.back()}>
          Volver a la carta
        </Button>
      </div>
    );
  }

  const relacionados = (menuData.items ?? [])
    .filter(
      (i: any) => i.category_id === item.category_id && i.id !== item.id && i.is_available,
    )
    .slice(0, 8);
  const categoryName = (menuData.categories ?? []).find(
    (c: any) => c.id === item.category_id,
  )?.name;

  const agotado = !item.is_available;
  const puedeAgregar = !agotado && !groupsError && !blocked;

  return (
    <div className="relative pb-32">
      {/* ── Foto ─────────────────────────────────────────────────────────── */}
      <div className="relative h-[224px] bg-muted">
        {item.image_url ? (
          <>
            <Image src={item.image_url} alt="" fill unoptimized className="object-cover" />
            {/* Sin esto la foto termina en una línea recta contra el panel. El
                degradado la funde con el fondo y el redondeo se lee. */}
            <span
              aria-hidden="true"
              className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-background to-transparent"
            />
          </>
        ) : (
          <span className="flex h-full items-center justify-center">
            <UtensilsCrossed className="h-10 w-10 text-muted-foreground/40" aria-hidden="true" />
          </span>
        )}
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Volver a la carta"
          className="absolute left-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-background/90 backdrop-blur"
        >
          <ChevronLeft className="h-[18px] w-[18px]" aria-hidden="true" />
        </button>
      </div>

      {/* ── Cabecera del plato ───────────────────────────────────────────── */}
      <div className="relative -mt-7 rounded-t-[28px] bg-background px-5 pb-2 pt-6">
        <div className="flex items-start justify-between gap-4">
          <h1 className="text-[26px] font-medium leading-tight">{item.name}</h1>
          <span className="whitespace-nowrap pt-1 text-[18px] font-semibold">
            {formatCurrency(item.price, currency)}
          </span>
        </div>

        {item.description && (
          <p className="mt-2 text-[14px] leading-relaxed text-muted-foreground">
            {item.description}
          </p>
        )}

        {/* Datos que ya llegaban de la API y no se pintaban: sin ellos, un plato
            sin opciones dejaba la ficha con nombre, precio y una línea suelta. */}
        <DishFacts
          prepTime={item.preparation_time_min}
          spiceLevel={item.spice_level}
          dietaryTags={item.dietary_tags}
          allergens={item.allergens}
          hasOptions={groups.length > 0}
        />

        <AlreadyOrdered menuItemId={item.id} currency={currency} />

        {/* Aviso de lo que falta. Aparece solo tras el primer intento o toque:
            recibir al comensal con un error antes de que haga nada es hostil. */}
        {touched && firstIssue && (
          <button
            type="button"
            onClick={goToIssue}
            className={cn(
              "mt-4 flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left",
              firstIssue.blocked
                ? "border-destructive/40 bg-destructive/10"
                : "border-amber-500/40 bg-amber-500/10",
            )}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <AlertCircle
                className={cn(
                  "h-4 w-4 shrink-0",
                  firstIssue.blocked ? "text-destructive" : "text-amber-700 dark:text-amber-400",
                )}
                aria-hidden="true"
              />
              <span
                className={cn(
                  "text-[13px]",
                  firstIssue.blocked ? "text-destructive" : "text-amber-800 dark:text-amber-300",
                )}
              >
                {firstIssue.message}
              </span>
            </span>
            {!firstIssue.blocked && (
              <span className="shrink-0 text-[13px] font-semibold text-primary">Ir</span>
            )}
          </button>
        )}

        {groupsError && (
          <div
            role="alert"
            className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3"
          >
            <p className="text-[13px] text-destructive">{groupsError}</p>
            <Button variant="outline" className="h-9" onClick={loadGroups}>
              Reintentar
            </Button>
          </div>
        )}

        {/* ── Grupos de opciones ─────────────────────────────────────────── */}
        {groups.map((group) => {
          const min = requiredMinimum(group);
          const max = maximumAllowed(group);
          const chosen = selection[group.id] ?? [];
          const single = isSingleChoice(group);
          const full = max !== null && chosen.length >= max;
          const pending = touched && issues.some((i) => i.groupId === group.id);

          return (
            <section
              key={group.id}
              ref={(el) => {
                groupRefs.current[group.id] = el;
              }}
              className="mt-6 scroll-mt-24"
            >
              <div className="mb-2.5 flex items-baseline justify-between gap-3">
                <h2
                  className={cn(
                    "text-[15px] font-semibold",
                    pending && "text-amber-700 dark:text-amber-400",
                  )}
                >
                  {group.name}
                </h2>
                <span
                  className={cn(
                    "text-[12px]",
                    pending ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground",
                  )}
                >
                  {min > 0
                    ? min === 1
                      ? "Elige 1"
                      : `Elige ${min}`
                    : max
                      ? `Hasta ${max} · opcional`
                      : "Opcional"}
                  {max && max > 1 ? ` · ${chosen.length} de ${max}` : ""}
                </span>
              </div>

              {isUnsatisfiable(group) ? (
                <p className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-[13px] text-destructive">
                  Se acabaron todas las opciones de {group.name.toLowerCase()}. Llama al mozo
                  para que te ayude con este plato.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {group.modifiers.map((option) => {
                    const selected = chosen.includes(option.id);
                    // Con el grupo lleno, lo NO elegido se atenúa y explica por
                    // qué no responde, en vez de ignorar el toque en silencio.
                    const blockedByLimit = !selected && full;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => choose(group, option.id)}
                        aria-pressed={selected}
                        className={cn(
                          "flex min-h-[52px] items-center gap-3 rounded-xl border px-4 text-left transition-colors",
                          selected ? "border-foreground border-[1.5px]" : "border-border",
                          blockedByLimit && "opacity-55",
                        )}
                      >
                        <span
                          className={cn(
                            "flex h-[18px] w-[18px] shrink-0 items-center justify-center border",
                            single ? "rounded-full" : "rounded-[6px]",
                            selected
                              ? "border-foreground bg-foreground text-background"
                              : "border-muted-foreground/40",
                          )}
                        >
                          {selected && !single && (
                            <Check className="h-3 w-3" strokeWidth={3.5} aria-hidden="true" />
                          )}
                          {selected && single && (
                            <span className="h-2 w-2 rounded-full bg-background" />
                          )}
                        </span>
                        <span className="flex-1 text-[15px]">{option.name}</span>
                        <span className="shrink-0 text-[13px] text-muted-foreground">
                          {option.price > 0
                            ? `+ ${formatCurrency(option.price, currency)}`
                            : blockedByLimit
                              ? "Quita uno para añadirlo"
                              : "Incluido"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {atLimitGroup === group.id && (
                <p role="status" className="mt-2 text-[12px] text-muted-foreground">
                  Ya elegiste el máximo. Quita uno para añadir otro.
                </p>
              )}
            </section>
          );
        })}

        {/* ── Nota para la cocina ────────────────────────────────────────── */}
        <div className="mt-6">
          {showNotes ? (
            <label className="block">
              <span className="mb-2 block text-[15px] font-semibold">Nota para la cocina</span>
              <textarea
                value={notes}
                autoFocus
                maxLength={500}
                rows={3}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Sin cebolla, ají aparte…"
                className="w-full rounded-xl border border-border bg-card px-4 py-3 text-[14px] outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
          ) : (
            <button
              type="button"
              onClick={() => setShowNotes(true)}
              className="flex h-12 w-full items-center gap-2.5 rounded-xl bg-muted/60 px-4 text-left"
            >
              <NotebookPen className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <span className="text-[14px] text-muted-foreground">
                {notes.trim() ? notes.trim() : "Nota para la cocina"}
              </span>
            </button>
          )}
        </div>

        <RelatedDishes
          dishes={relacionados}
          categoryName={categoryName}
          currency={currency}
          onOpen={(id) => router.replace(`/${branchSlug}/${tableCode}/menu/${id}`)}
        />
      </div>

      {/* ── Pie: cantidad y añadir ───────────────────────────────────────── */}
      <div className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-3 border-t border-border bg-background px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        <div className="flex h-14 shrink-0 items-center rounded-full border border-border px-1.5">
          <button
            type="button"
            onClick={() => setQuantity((q) => Math.max(1, q - 1))}
            disabled={quantity <= 1}
            aria-label="Quitar una unidad"
            className="flex h-11 w-11 items-center justify-center rounded-full disabled:opacity-40"
          >
            <Minus className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>
          <span className="min-w-[1.5rem] text-center text-[16px] font-semibold tabular-nums">
            {quantity}
          </span>
          <button
            type="button"
            onClick={() => setQuantity((q) => Math.min(99, q + 1))}
            aria-label="Añadir una unidad"
            className="flex h-11 w-11 items-center justify-center rounded-full"
          >
            <Plus className="h-[18px] w-[18px]" aria-hidden="true" />
          </button>
        </div>

        {/*
          El botón dice lo que toca hacer. Con algo pendiente no promete
          "Agregar" para luego negarse: lleva al grupo que falta.
        */}
        <button
          type="button"
          onClick={add}
          disabled={!puedeAgregar}
          className={cn(
            "flex h-14 flex-1 items-center justify-center gap-2.5 rounded-full text-[15px] transition-colors",
            !puedeAgregar
              ? "bg-muted text-muted-foreground"
              : issues.length > 0
                ? "border-[1.5px] border-foreground bg-background text-foreground"
                : "bg-primary text-primary-foreground",
          )}
        >
          {agotado ? (
            <span className="font-medium">Agotado</span>
          ) : blocked ? (
            <span className="font-medium">No disponible ahora</span>
          ) : issues.length > 0 ? (
            <>
              <span className="font-medium">{firstIssue?.message}</span>
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </>
          ) : (
            <>
              <span className="font-medium">Agregar</span>
              <span className="opacity-50">·</span>
              <span className="font-semibold tabular-nums">
                {formatCurrency(total, currency)}
              </span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}
