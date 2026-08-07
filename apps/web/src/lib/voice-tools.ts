"use client";

import { useCartStore } from "@/stores/cart-store";
import type { VoiceCatalogEntry } from "@/hooks/use-voice-agent";

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
  };
  onOrderPlaced: (order: { id: string; orderNumber: string }) => void;
}

/** Normaliza para comparar nombres dichos en voz alta ("ají" ≈ "AJI"). */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
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
    const total = cart.getTotal(taxRate);
    return {
      items,
      vacio: items.length === 0,
      subtotal_centimos: cart.getSubtotal(),
      igv_centimos: cart.getTax(taxRate),
      total_centimos: total,
      total_texto: money(total),
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
        return { ok: true, agregado: entry.name, cantidad: quantity, carrito: readCart() };
      }

      case "quitar_del_carrito": {
        const entry = resolveRef(args.ref);
        if (!entry) return { error: "Esa referencia no existe en la carta." };

        const cart = useCartStore.getState();
        const line = cart.items.find((i) => i.menuItemId === entry.id);
        if (!line) return { error: `${entry.name} no está en el pedido.` };

        const remove = Number(args.cantidad);
        if (Number.isFinite(remove) && remove > 0 && remove < line.quantity) {
          cart.updateLineQuantity(line.lineId, line.quantity - remove);
        } else {
          cart.removeLine(line.lineId);
        }
        return { ok: true, quitado: entry.name, carrito: readCart() };
      }

      case "leer_carrito":
        return readCart();

      case "confirmar_pedido": {
        const cart = useCartStore.getState();
        if (cart.items.length === 0) {
          return { error: "El pedido está vacío. No hay nada que enviar." };
        }

        const realTotal = cart.getTotal(taxRate);
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
        onOrderPlaced({ id: payload.data.id, orderNumber: payload.data.order_number });

        return {
          ok: true,
          numero_pedido: payload.data.order_number,
          mensaje:
            "Pedido enviado a cocina. Confírmaselo al comensal y avísale que puede cancelarlo desde la pantalla si se equivocó.",
        };
      }

      default:
        return { error: `Herramienta desconocida: ${name}` };
    }
  };
}
