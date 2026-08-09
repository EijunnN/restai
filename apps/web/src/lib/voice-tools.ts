"use client";

import { useCartStore } from "@/stores/cart-store";
import { useCustomerStore } from "@/stores/customer-store";
import type { CartItem } from "@restai/types";
import type { VoiceCatalogEntry } from "@/hooks/use-voice-agent";
import {
  computeCouponDiscount,
  computeRedemptionDiscount,
  computeTotals,
  type AppliedCoupon,
  type PendingRedemption,
} from "@/lib/cart-discounts";

/**
 * Herramientas del mesero por voz.
 *
 * Aquí vive TODO lo que el agente puede hacer. Dos principios guían el archivo:
 *
 *  - **El agente propone, el servidor dispone.** Ninguna herramienta calcula
 *    precios ni decide disponibilidad: `confirmar_pedido` desemboca en el mismo
 *    `POST /api/customer/orders` que usa la carta táctil, que revalida todo
 *    contra la base. Si el agente alucina un plato de dos soles, el pedido se
 *    cobra al precio real o se rechaza.
 *  - **Un error es un dato, no una excepción.** Cada herramienta devuelve algo
 *    que el modelo pueda leer y con lo que pueda rectificar en voz alta. Nunca
 *    lanza: una excepción deja al agente callado a mitad de frase.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export interface VoiceMenuItem {
  id: string;
  name: string;
  description: string | null;
  price: number;
  image_url?: string | null;
  is_available: boolean;
  category_id: string;
  has_modifiers?: boolean;
  allergens?: string[];
  dietary_tags?: string[];
  spice_level?: number | null;
}

export interface ModifierGroup {
  id: string;
  name: string;
  min_selections: number;
  max_selections: number;
  is_required: boolean;
  modifiers: { id: string; name: string; price: number; is_available: boolean }[];
}

export interface VoiceToolDeps {
  /** Mapa `ref → uuid` que emitió el servidor junto con la credencial. */
  catalog: VoiceCatalogEntry[];
  /** La carta completa que ya cargó la pantalla (trae imágenes y descripciones). */
  menuItems: VoiceMenuItem[];
  branchSlug: string;
  token: string;
  /** IGV de la sede en puntos básicos (1800 = 18%). */
  taxRate: number;
  /** Efectos en pantalla. Son la mitad del producto: la voz sin imagen es un teléfono. */
  visuals: {
    showItems: (itemIds: string[], title?: string) => void;
    focusItem: (itemId: string) => void;
    /**
     * Enseña las opciones de un plato mientras el mesero pregunta por ellas.
     *
     * Sin esto, el agente decía "¿lo quieres con ají extra o sin cebolla?" y la
     * pantalla seguía enseñando la foto: el comensal tenía que retener de
     * memoria una lista hablada, que es justo lo que una pantalla evita.
     */
    showOptions: (itemId: string, groups: ModifierGroup[]) => void;
    /** Opciones ya resueltas: se marcan las elegidas y el panel se retira. */
    resolveOptions: (chosen: string[]) => void;
  };
  onOrderPlaced: (order: { id: string; orderNumber: string }) => void;
}

/** Normaliza para comparar nombres dichos en voz alta ("ají" ≈ "AJI"). */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function money(cents: number): string {
  return `S/ ${(cents / 100).toFixed(2)}`;
}

export type VoiceToolExecutor = (
  name: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

export function createVoiceTools(deps: VoiceToolDeps): VoiceToolExecutor {
  const { catalog, menuItems, branchSlug, token, taxRate, visuals, onOrderPlaced } = deps;

  const byRef = new Map(catalog.map((entry) => [entry.ref, entry]));
  const itemById = new Map(menuItems.map((item) => [item.id, item]));

  /**
   * Detalle de modificadores ya consultado, por id de plato.
   *
   * Se cachea porque `agregar_al_carrito` necesita resolver los modificadores
   * que el comensal eligió DE VIVA VOZ ("con ají extra") contra los ids reales,
   * y sería absurdo volver a pedirlos a la API un segundo después de que
   * `ver_detalle_plato` los trajera.
   */
  const modifierCache = new Map<string, ModifierGroup[]>();

  const menuItemNames: Record<string, string> = Object.fromEntries(
    menuItems.map((item) => [item.id, item.name]),
  );

  /**
   * Cupón y canje elegidos durante la conversación.
   *
   * Viven en el closure y no en el store del carrito porque son de ESTA
   * conversación: si el comensal abandona la voz y termina en la carta táctil,
   * allí vuelve a elegirlos a mano, como siempre. Guardarlos en el carrito haría
   * que un descuento hablado apareciera aplicado en una pantalla que nunca lo
   * mostró.
   */
  let appliedCoupon: AppliedCoupon | null = null;
  let appliedRedemption: PendingRedemption | null = null;

  function resolveRef(ref: unknown): VoiceCatalogEntry | null {
    if (typeof ref !== "string" && typeof ref !== "number") return null;
    return byRef.get(String(ref).replace(/[^\d]/g, "")) ?? byRef.get(String(ref)) ?? null;
  }

  async function loadModifiers(itemId: string): Promise<ModifierGroup[]> {
    const cached = modifierCache.get(itemId);
    if (cached) return cached;

    const res = await fetch(
      `${API_URL}/api/customer/${branchSlug}/menu/items/${itemId}/modifiers`,
    );
    const payload = await res.json();
    const groups: ModifierGroup[] = payload?.success ? payload.data : [];
    modifierCache.set(itemId, groups);
    return groups;
  }

  /**
   * Encuentra LA línea del carrito sobre la que actuar.
   *
   * El mismo plato puede estar dos veces con opciones distintas —un ceviche con
   * ají y otro sin—, y son líneas separadas. Antes se cogía la primera que
   * coincidiera por producto: si el comensal decía "quítame el que lleva ají",
   * se borraba el otro y nadie se enteraba hasta que llegaba la comida.
   *
   * Con varias candidatas y sin pistas se devuelve un error que enumera las
   * variantes, para que el agente PREGUNTE en vez de adivinar.
   */
  function resolveLine(
    menuItemId: string,
    hint: unknown,
  ): { line: CartItem } | { error: string; variantes?: string[] } {
    const lines = useCartStore.getState().items.filter((i) => i.menuItemId === menuItemId);
    if (lines.length === 0) return { error: "Ese plato no está en el pedido." };
    if (lines.length === 1) return { line: lines[0] };

    const hints = Array.isArray(hint)
      ? (hint as unknown[]).map((h) => normalize(String(h)))
      : typeof hint === "string" && hint
        ? [normalize(hint)]
        : [];

    const describe = (line: CartItem) =>
      line.modifiers.length > 0 ? line.modifiers.map((m) => m.name).join(" + ") : "sin opciones";

    if (hints.length > 0) {
      const matches = lines.filter((line) => {
        const names = line.modifiers.map((m) => normalize(m.name));
        return hints.every((h) => names.some((n) => n.includes(h) || h.includes(n)));
      });
      if (matches.length === 1) return { line: matches[0] };
    }

    return {
      error:
        "Ese plato está en el pedido más de una vez, con opciones distintas. Pregúntale al comensal a cuál se refiere y vuelve a llamarme indicando las opciones.",
      variantes: lines.map(describe),
    };
  }

  /**
   * Descuentos vigentes, con la MISMA aritmética que la pantalla del carrito
   * (`lib/cart-discounts.ts`), que a su vez replica la del servidor. Es lo que
   * garantiza que el total dicho en voz alta sea el que se cobra.
   */
  function currentDiscounts() {
    const cart = useCartStore.getState();
    const subtotal = cart.getSubtotal();

    const coupon = computeCouponDiscount({
      coupon: appliedCoupon,
      items: cart.items,
      subtotal,
      menuItemNames,
    });
    const redemption = computeRedemptionDiscount({
      redemption: appliedRedemption,
      items: cart.items,
      subtotal,
      couponDiscount: coupon.discount,
      menuItemNames,
    });

    const totalDiscount = coupon.discount + redemption.discount;
    const totals = computeTotals({ subtotal, totalDiscount, taxRate });

    return { subtotal, coupon, redemption, totalDiscount, ...totals };
  }

  /** Estado real del carrito, en la forma en que el modelo lo entiende. */
  function readCart() {
    const cart = useCartStore.getState();
    const items = cart.items.map((line) => ({
      plato: line.name,
      cantidad: line.quantity,
      opciones: line.modifiers.map((m) => m.name),
      notas: line.notes || undefined,
      subtotal_centimos:
        (line.unitPrice + line.modifiers.reduce((sum, m) => sum + m.price, 0)) * line.quantity,
    }));

    const d = currentDiscounts();

    return {
      items,
      vacio: items.length === 0,
      subtotal_centimos: d.subtotal,
      descuento_centimos: d.totalDiscount,
      igv_centimos: d.tax,
      total_centimos: d.total,
      total_texto: money(d.total),
      cupon: appliedCoupon
        ? {
            codigo: appliedCoupon.code,
            nombre: appliedCoupon.name,
            descuento: money(d.coupon.discount),
            no_aplica_porque: d.coupon.blockedReason ?? undefined,
            // Cuando el importe lo pone el servidor no se puede prometer un
            // total exacto: decirlo es la diferencia entre informar y mentir.
            importe_lo_calcula_el_servidor: d.coupon.serverOnly || undefined,
          }
        : undefined,
      canje: appliedRedemption
        ? {
            recompensa: appliedRedemption.reward_name,
            descuento: money(d.redemption.discount),
            no_aplica_porque: d.redemption.blockedReason ?? undefined,
          }
        : undefined,
      aviso_total_estimado: d.coupon.serverOnly
        ? "Este cupón lo calcula la caja al confirmar. Di el total SIN ese descuento y avisa de que el descuento se aplicará al enviar el pedido."
        : undefined,
    };
  }

  return async function execute(name, args) {
    switch (name) {
      // ── Pantalla ─────────────────────────────────────────────────────────
      case "mostrar_platos": {
        const refs = Array.isArray(args.refs) ? args.refs : [];
        const resolved = refs.map(resolveRef).filter(Boolean) as VoiceCatalogEntry[];
        if (resolved.length === 0) {
          return { error: "Ninguna de esas referencias existe en la carta." };
        }
        const limited = resolved.slice(0, 6);
        visuals.showItems(
          limited.map((e) => e.id),
          typeof args.titulo === "string" ? args.titulo : undefined,
        );
        return {
          ok: true,
          mostrados: limited.map((e) => ({
            ref: e.ref,
            nombre: e.name,
            precio: money(e.price),
            disponible: e.available,
          })),
        };
      }

      case "enfocar_plato": {
        const entry = resolveRef(args.ref);
        if (!entry) return { error: "Esa referencia no existe en la carta." };
        visuals.focusItem(entry.id);
        return { ok: true, nombre: entry.name, precio: money(entry.price) };
      }

      // ── Carta ────────────────────────────────────────────────────────────
      case "buscar_platos": {
        const query = typeof args.consulta === "string" ? normalize(args.consulta) : "";
        const category = typeof args.categoria === "string" ? normalize(args.categoria) : "";
        const tag = typeof args.etiqueta === "string" ? normalize(args.etiqueta) : "";
        const without = Array.isArray(args.sin_alergeno)
          ? (args.sin_alergeno as unknown[]).map((a) => normalize(String(a)))
          : [];
        const onlyAvailable = args.solo_disponibles === true;

        const results = catalog.filter((entry) => {
          const item = itemById.get(entry.id);
          if (onlyAvailable && !entry.available) return false;
          if (category && !normalize(entry.categoryName).includes(category)) return false;
          if (tag && !(item?.dietary_tags ?? []).some((t) => normalize(t).includes(tag))) {
            return false;
          }
          if (
            without.length > 0 &&
            (item?.allergens ?? []).some((a) => without.includes(normalize(a)))
          ) {
            return false;
          }
          if (query) {
            const haystack = normalize(
              `${entry.name} ${entry.categoryName} ${item?.description ?? ""}`,
            );
            if (!haystack.includes(query)) return false;
          }
          return true;
        });

        if (results.length === 0) {
          return { resultados: [], nota: "No hay nada en la carta que encaje con eso." };
        }

        return {
          // Ocho es lo máximo que tiene sentido: el agente no va a recitar más
          // en voz alta, y la pantalla solo muestra seis.
          resultados: results.slice(0, 8).map((e) => ({
            ref: e.ref,
            nombre: e.name,
            categoria: e.categoryName,
            precio: money(e.price),
            disponible: e.available,
            tiene_opciones: e.hasModifiers,
          })),
          total_encontrados: results.length,
        };
      }

      case "ver_detalle_plato": {
        const entry = resolveRef(args.ref);
        if (!entry) return { error: "Esa referencia no existe en la carta." };
        const item = itemById.get(entry.id);
        const groups = entry.hasModifiers ? await loadModifiers(entry.id) : [];

        // La pantalla enseña las opciones a la vez que el mesero las pregunta.
        visuals.focusItem(entry.id);
        if (groups.length > 0) visuals.showOptions(entry.id, groups);

        return {
          ref: entry.ref,
          nombre: entry.name,
          descripcion: item?.description ?? null,
          precio: money(entry.price),
          disponible: entry.available,
          alergenos: item?.allergens ?? [],
          etiquetas: item?.dietary_tags ?? [],
          opciones: groups.map((g) => ({
            grupo: g.name,
            obligatorio: g.is_required,
            elegir_maximo: g.max_selections,
            alternativas: g.modifiers
              .filter((m) => m.is_available)
              .map((m) => ({
                nombre: m.name,
                recargo: m.price > 0 ? money(m.price) : "sin recargo",
              })),
          })),
        };
      }

      // ── Pedido ───────────────────────────────────────────────────────────
      case "agregar_al_carrito": {
        const entry = resolveRef(args.ref);
        if (!entry) return { error: "Esa referencia no existe en la carta." };
        if (!entry.available) {
          return {
            error: `Hoy no queda ${entry.name}. Dilo con naturalidad y ofrece otra cosa.`,
          };
        }

        const quantity = Math.max(1, Math.min(99, Number(args.cantidad) || 1));
        const chosen = Array.isArray(args.modificadores)
          ? (args.modificadores as unknown[]).map((m) => String(m))
          : [];

        const groups = entry.hasModifiers ? await loadModifiers(entry.id) : [];
        const selected: { modifierId: string; name: string; price: number }[] = [];

        for (const raw of chosen) {
          const wanted = normalize(raw);
          let found: { id: string; name: string; price: number } | undefined;
          for (const group of groups) {
            found = group.modifiers.find(
              (m) => m.is_available && normalize(m.name) === wanted,
            );
            if (found) break;
          }
          // Coincidencia laxa como segundo intento: al dictar, "ají" y "ají
          // extra" son la misma intención.
          if (!found) {
            for (const group of groups) {
              found = group.modifiers.find(
                (m) =>
                  m.is_available &&
                  (normalize(m.name).includes(wanted) || wanted.includes(normalize(m.name))),
              );
              if (found) break;
            }
          }
          if (!found) {
            return {
              error: `No existe la opción "${raw}" para ${entry.name}.`,
              opciones_validas: groups.flatMap((g) =>
                g.modifiers.filter((m) => m.is_available).map((m) => m.name),
              ),
            };
          }
          selected.push({ modifierId: found.id, name: found.name, price: found.price });
        }

        // Los grupos obligatorios se comprueban AQUÍ para que el agente pueda
        // preguntar por ellos hablando. Si se dejara para el envío, el pedido
        // se rechazaría al final, cuando el comensal ya cree que terminó.
        const missing = groups.filter(
          (g) =>
            g.is_required &&
            !selected.some((s) => g.modifiers.some((m) => m.id === s.modifierId)),
        );
        if (missing.length > 0) {
          return {
            error: `Falta elegir: ${missing.map((g) => g.name).join(", ")}. Pregúntaselo al comensal.`,
            grupos_pendientes: missing.map((g) => ({
              grupo: g.name,
              alternativas: g.modifiers.filter((m) => m.is_available).map((m) => m.name),
            })),
          };
        }

        useCartStore.getState().addItem({
          menuItemId: entry.id,
          name: entry.name,
          unitPrice: entry.price,
          quantity,
          notes: typeof args.notas === "string" && args.notas ? args.notas : undefined,
          modifiers: selected,
        });

        visuals.focusItem(entry.id);
        // Las opciones elegidas se marcan en pantalla antes de que el panel se
        // retire: el comensal ve confirmado lo que acaba de decir en voz alta.
        visuals.resolveOptions(selected.map((s) => s.name));
        return { ok: true, agregado: entry.name, cantidad: quantity, carrito: readCart() };
      }

      case "quitar_del_carrito": {
        const entry = resolveRef(args.ref);
        if (!entry) return { error: "Esa referencia no existe en la carta." };

        const cart = useCartStore.getState();
        const resolved = resolveLine(entry.id, args.opciones);
        if ("error" in resolved) return resolved;
        const { line } = resolved;

        const remove = Number(args.cantidad);
        if (Number.isFinite(remove) && remove > 0 && remove < line.quantity) {
          cart.updateLineQuantity(line.lineId, line.quantity - remove);
        } else {
          cart.removeLine(line.lineId);
        }
        return { ok: true, quitado: entry.name, carrito: readCart() };
      }

      case "cambiar_cantidad": {
        const entry = resolveRef(args.ref);
        if (!entry) return { error: "Esa referencia no existe en la carta." };

        const target = Number(args.cantidad);
        if (!Number.isFinite(target) || target < 0) {
          return { error: "Cantidad inválida." };
        }

        const resolved = resolveLine(entry.id, args.opciones);
        if ("error" in resolved) return resolved;

        // Se FIJA la cantidad en vez de sumar o restar. "Que sean tres" no
        // obliga al agente a calcular cuántos faltaban, que es justo donde se
        // equivocaría y donde el error acaba en la cocina.
        useCartStore.getState().updateLineQuantity(resolved.line.lineId, Math.min(99, target));
        return { ok: true, plato: entry.name, cantidad: target, carrito: readCart() };
      }

      case "poner_nota": {
        const entry = resolveRef(args.ref);
        if (!entry) return { error: "Esa referencia no existe en la carta." };

        const resolved = resolveLine(entry.id, args.opciones);
        if ("error" in resolved) return resolved;

        const note = typeof args.notas === "string" ? args.notas : "";
        useCartStore.getState().updateLineNotes(resolved.line.lineId, note);
        return {
          ok: true,
          plato: entry.name,
          nota: note || "(sin nota)",
          aviso:
            "Una indicación no cambia el precio ni garantiza que la cocina pueda cumplirla. No prometas que sí.",
        };
      }

      case "vaciar_carrito": {
        useCartStore.getState().clearCart();
        return { ok: true, mensaje: "Pedido vaciado. Empiecen de nuevo." };
      }

      case "llamar_mozo": {
        const sessionId = useCustomerStore.getState().sessionId;
        if (!sessionId) return { error: "No hay sesión de mesa activa." };

        const action = args.motivo === "cuenta" ? "request_bill" : "call_waiter";
        const res = await fetch(`${API_URL}/api/customer/table-action`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action, tableSessionId: sessionId }),
        });
        const payload = await res.json();

        if (!res.ok || !payload?.success) {
          // 409 = ya hay un aviso pendiente para esta mesa. No es un fallo:
          // significa que el mozo ya viene, y eso es lo que hay que decirle al
          // comensal en vez de insistir.
          if (res.status === 409) {
            return { ok: true, ya_avisado: true, mensaje: "Ya hay un aviso pendiente; el mozo ya viene." };
          }
          return { error: payload?.error?.message || "No se pudo avisar al personal." };
        }

        return {
          ok: true,
          mensaje:
            action === "request_bill"
              ? "Pedimos la cuenta. Avísale que el mozo se acerca."
              : "Llamamos al mozo. Avísale que ya viene.",
        };
      }

      case "leer_carrito":
        return readCart();

      // ── Cupones y fidelidad ──────────────────────────────────────────────
      case "aplicar_cupon": {
        const code = typeof args.codigo === "string" ? args.codigo.trim().toUpperCase() : "";
        if (!code) return { error: "No entendí el código del cupón." };

        const res = await fetch(`${API_URL}/api/customer/validate-coupon`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ code }),
        });
        const payload = await res.json();

        if (!res.ok || !payload?.success) {
          return {
            error: payload?.error?.message || "Ese cupón no es válido.",
            // El agente no debe insistir ni buscarle la vuelta: el cupón lo
            // valida el servidor y su palabra es definitiva.
            sugerencia: "Dilo con naturalidad y sigue con el pedido.",
          };
        }

        appliedCoupon = payload.data as AppliedCoupon;
        const d = currentDiscounts();

        if (d.coupon.blockedReason) {
          // Se conserva aplicado: el motivo suele ser "faltan S/ 10 para el
          // mínimo", y el descuento entra solo en cuanto se agregue algo más.
          return {
            ok: true,
            cupon: appliedCoupon.name,
            aplicado: false,
            motivo: d.coupon.blockedReason,
            carrito: readCart(),
          };
        }

        return {
          ok: true,
          cupon: appliedCoupon.name,
          aplicado: true,
          descuento: d.coupon.serverOnly ? "lo calcula la caja al confirmar" : money(d.coupon.discount),
          carrito: readCart(),
        };
      }

      case "quitar_cupon": {
        if (!appliedCoupon) return { error: "No hay ningún cupón aplicado." };
        const name = appliedCoupon.name;
        appliedCoupon = null;
        return { ok: true, quitado: name, carrito: readCart() };
      }

      case "ver_mis_puntos": {
        const res = await fetch(`${API_URL}/api/customer/my-loyalty`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const payload = await res.json();

        // `data: null` significa que este comensal no tiene cuenta de fidelidad
        // (entró por QR sin registrarse). No es un error: es que no aplica.
        if (!res.ok || !payload?.success || !payload.data) {
          return {
            sin_cuenta: true,
            mensaje:
              "Este comensal no tiene cuenta de fidelidad. Puede registrarse desde la carta con su correo; no insistas si no le interesa.",
          };
        }

        const data = payload.data as {
          points_balance: number;
          program_name?: string;
          tier_name?: string | null;
          rewards?: {
            id: string;
            name: string;
            points_cost: number;
            description?: string | null;
          }[];
        };

        const rewards = data.rewards ?? [];
        return {
          puntos: data.points_balance,
          nivel: data.tier_name ?? undefined,
          recompensas: rewards.map((r) => ({
            nombre: r.name,
            cuesta_puntos: r.points_cost,
            alcanza: data.points_balance >= r.points_cost,
            descripcion: r.description ?? undefined,
          })),
        };
      }

      case "canjear_recompensa": {
        const wanted = typeof args.recompensa === "string" ? normalize(args.recompensa) : "";
        if (!wanted) return { error: "No entendí qué recompensa quiere canjear." };

        const listRes = await fetch(`${API_URL}/api/customer/my-loyalty`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const listPayload = await listRes.json();
        if (!listRes.ok || !listPayload?.success || !listPayload.data) {
          return { error: "Este comensal no tiene cuenta de fidelidad." };
        }

        const rewards = (listPayload.data.rewards ?? []) as {
          id: string;
          name: string;
          points_cost: number;
        }[];
        const match =
          rewards.find((r) => normalize(r.name) === wanted) ??
          rewards.find((r) => normalize(r.name).includes(wanted) || wanted.includes(normalize(r.name)));

        if (!match) {
          return {
            error: "No encontré esa recompensa.",
            disponibles: rewards.map((r) => r.name),
          };
        }

        // Canjear GASTA los puntos de forma irreversible, aunque después el
        // pedido no llegue a enviarse. Por eso la herramienta exige que el
        // comensal lo haya confirmado y el prompt obliga a preguntarlo.
        const res = await fetch(`${API_URL}/api/customer/redeem-reward`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ rewardId: match.id }),
        });
        const payload = await res.json();
        if (!res.ok || !payload?.success) {
          return { error: payload?.error?.message || "No se pudo canjear la recompensa." };
        }

        const redemption = payload.data as PendingRedemption & { reward_name?: string };
        appliedRedemption = {
          id: redemption.id,
          reward_name: redemption.reward_name ?? match.name,
          reward_type: redemption.reward_type ?? null,
          discount_type: redemption.discount_type ?? null,
          discount_value: redemption.discount_value ?? null,
          menu_item_id: redemption.menu_item_id ?? null,
        };

        const d = currentDiscounts();
        return {
          ok: true,
          recompensa: appliedRedemption.reward_name,
          puntos_gastados: match.points_cost,
          descuento: money(d.redemption.discount),
          no_aplica_porque: d.redemption.blockedReason ?? undefined,
          carrito: readCart(),
        };
      }

      // ── Después de enviar ────────────────────────────────────────────────
      case "estado_del_pedido": {
        const res = await fetch(`${API_URL}/api/customer/my-orders`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const payload = await res.json();
        if (!res.ok || !payload?.success) {
          return { error: "No pude consultar el estado del pedido." };
        }

        const orders = (payload.data ?? []) as {
          order_number: string;
          status: string;
          items: { name: string; quantity: number; status: string }[];
        }[];
        if (orders.length === 0) {
          return { sin_pedidos: true, mensaje: "Esta mesa todavía no ha enviado nada a cocina." };
        }

        const LABELS: Record<string, string> = {
          pending: "recibido, aún no empieza",
          confirmed: "confirmado",
          preparing: "en preparación",
          ready: "listo, sale en breve",
          served: "servido",
          completed: "cerrado",
          cancelled: "anulado",
        };

        return {
          pedidos: orders.map((o) => ({
            comanda: o.order_number,
            estado: LABELS[o.status] ?? o.status,
            platos: o.items.map((i) => `${i.quantity}× ${i.name} (${LABELS[i.status] ?? i.status})`),
          })),
          // Sin esto el agente se inventa un "sale en cinco minutos" que nadie
          // le ha dicho, y el comensal lo toma por una promesa del local.
          aviso: "No inventes tiempos de espera. Si insisten, usa llamar_mozo.",
        };
      }

      case "confirmar_pedido": {
        const cart = useCartStore.getState();
        if (cart.items.length === 0) {
          return { error: "El pedido está vacío. No hay nada que enviar." };
        }

        const d = currentDiscounts();
        const realTotal = d.total;
        const claimed = Number(args.total_esperado_centimos);

        // ── La salvaguarda del cierre por voz ──────────────────────────────
        // El pedido se confirma hablando, así que esto es lo único que se
        // interpone entre un "sí" mal entendido y una comanda real en cocina.
        // Si el total que el agente acaba de leer en voz alta no es el del
        // carrito, algo cambió entre medias (o el agente se lo inventó): se
        // rechaza y se le obliga a releer el pedido al comensal.
        if (!Number.isFinite(claimed) || claimed !== realTotal) {
          return {
            error:
              "El total no coincide con el pedido real. NO confirmes: vuelve a leer el pedido en voz alta con el total correcto y pide confirmación otra vez.",
            total_real_centimos: realTotal,
            total_real_texto: money(realTotal),
            carrito: readCart(),
          };
        }

        const res = await fetch(`${API_URL}/api/customer/orders`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            type: "dine_in",
            items: cart.items.map((line) => ({
              menuItemId: line.menuItemId,
              quantity: line.quantity,
              notes: line.notes || undefined,
              modifiers: line.modifiers.map((m) => ({ modifierId: m.modifierId })),
            })),
            // El cupón se manda solo si de verdad descuenta algo, o si el
            // importe lo decide el servidor. Enviar uno que se puede demostrar
            // que no aplica gastaría un uso a cambio de nada — misma regla que
            // la carta táctil.
            ...(appliedCoupon && (!d.coupon.blockedReason || d.coupon.serverOnly)
              ? { couponCode: appliedCoupon.code }
              : {}),
            ...(appliedRedemption && !d.redemption.blockedReason
              ? { redemptionId: appliedRedemption.id }
              : {}),
          }),
        });
        const payload = await res.json();

        if (!res.ok || !payload?.success) {
          return {
            error: payload?.error?.message || "No se pudo enviar el pedido a cocina.",
            // El comensal no puede hacer nada con un código de error: el agente
            // tiene que explicárselo y ofrecer llamar a un mozo.
            sugerencia: "Discúlpate, explica que hubo un problema y ofrece llamar a un mozo.",
          };
        }

        cart.clearCart();
        // El cupón y el canje quedaron consumidos por el servidor: dejarlos
        // aquí haría que un segundo pedido de la misma mesa intentara volver a
        // usarlos y fuera rechazado sin que nadie entendiera por qué.
        const usedCoupon = appliedCoupon;
        appliedCoupon = null;
        appliedRedemption = null;

        onOrderPlaced({ id: payload.data.id, orderNumber: payload.data.order_number });

        // El total AUTORITATIVO es el que devuelve el servidor. Con un cupón
        // cuyo importe solo él conoce (2x1, por categoría), puede no coincidir
        // con lo que el agente acaba de decir: se le devuelve para que lo diga.
        const chargedTotal = payload.data.total as number | undefined;
        const differs = typeof chargedTotal === "number" && chargedTotal !== realTotal;

        return {
          ok: true,
          numero_pedido: payload.data.order_number,
          total_cobrado: typeof chargedTotal === "number" ? money(chargedTotal) : undefined,
          corregir_total: differs
            ? `El total final es ${money(chargedTotal!)}${usedCoupon ? ` con el cupón ${usedCoupon.name} ya aplicado` : ""}. Dilo en voz alta.`
            : undefined,
          mensaje:
            "Pedido enviado a cocina. Confírmaselo al comensal y avísale que puede cancelarlo desde la pantalla si se equivocó.",
        };
      }

      default:
        return { error: `Herramienta desconocida: ${name}` };
    }
  };
}
