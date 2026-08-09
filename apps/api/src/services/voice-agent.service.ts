import { eq, and, asc, isNull, inArray } from "drizzle-orm";
import { db, schema } from "@restai/db";
import type { VoiceToolDefinition } from "../lib/voice-providers/types.js";

/**
 * Configuración del mesero por voz de una sede.
 *
 * ── Referencias cortas en vez de UUID ────────────────────────────────────────
 * El agente nunca ve un uuid. Cada plato recibe una referencia corta (`12`) y
 * el servidor devuelve el mapa `ref → uuid` junto al secreto efímero; el
 * navegador traduce antes de llamar a la API. Dos razones, ambas prácticas:
 *
 *  1. Coste. Un uuid son ~15 tokens; con 80 platos en la carta, meterlos en las
 *     instrucciones cuesta ~1.200 tokens que se pagan en CADA turno de la
 *     conversación.
 *  2. Fiabilidad. Los modelos copian mal cadenas largas sin significado: un
 *     dígito cambiado en un uuid es un plato que no existe. Con `12` no hay
 *     margen de error, y si lo hubiera el fallo es evidente y recuperable.
 *
 * El mapeo lo emite el servidor, así que prompt y cliente no pueden divergir.
 */

/**
 * Tope de platos que se listan en las instrucciones.
 *
 * Una carta normal (30–80 platos) entra entera y el agente puede recomendar sin
 * consultar nada. Por encima del tope se listan solo las categorías y el agente
 * usa `buscar_platos`: prefiero una búsqueda de más a que una carta de 400
 * platos infle cada turno de la conversación.
 */
const MAX_ITEMS_IN_PROMPT = 150;

/** Lo que viaja al navegador: solo lo necesario para traducir `ref → uuid`. */
export interface VoiceCatalogEntry {
  ref: string;
  id: string;
  name: string;
  price: number;
  categoryId: string;
  categoryName: string;
  available: boolean;
  hasModifiers: boolean;
}

/** Lo que se usa para redactar las instrucciones (nunca sale del servidor). */
export interface VoiceCatalogItem extends VoiceCatalogEntry {
  description: string | null;
  allergens: string[];
  dietaryTags: string[];
  spiceLevel: number | null;
  prepTimeMin: number | null;
}

export interface VoiceAgentContext {
  instructions: string;
  catalog: VoiceCatalogEntry[];
  tools: VoiceToolDefinition[];
}

function currencySymbol(currency: string): string {
  if (currency === "PEN") return "S/";
  if (currency === "USD") return "$";
  return currency;
}

/** Céntimos → texto legible para el prompt ("S/ 35.00"). */
function formatMoney(cents: number, currency: string): string {
  return `${currencySymbol(currency)} ${(cents / 100).toFixed(2)}`;
}

/**
 * Carta de la sede en forma compacta.
 *
 * Replica los filtros del endpoint público de la carta
 * (`GET /api/customer/:branchSlug/:tableCode/menu`): solo categorías activas,
 * sin platos borrados, y los AGOTADOS se incluyen marcados en vez de ocultarse
 * —el agente tiene que poder decir "hoy no nos queda" en vez de fingir que ese
 * plato nunca existió, que es lo que hace que una conversación suene falsa.
 */
export async function loadVoiceCatalog(
  organizationId: string,
  branchId: string,
): Promise<VoiceCatalogItem[]> {
  const categories = await db
    .select({
      id: schema.menuCategories.id,
      name: schema.menuCategories.name,
      sort_order: schema.menuCategories.sort_order,
    })
    .from(schema.menuCategories)
    .where(
      and(
        eq(schema.menuCategories.organization_id, organizationId),
        eq(schema.menuCategories.branch_id, branchId),
        eq(schema.menuCategories.is_active, true),
      ),
    )
    .orderBy(asc(schema.menuCategories.sort_order), asc(schema.menuCategories.name));

  const categoryIds = categories.map((cat) => cat.id);
  if (categoryIds.length === 0) return [];

  const items = await db
    .select({
      id: schema.menuItems.id,
      category_id: schema.menuItems.category_id,
      name: schema.menuItems.name,
      description: schema.menuItems.description,
      price: schema.menuItems.price,
      is_available: schema.menuItems.is_available,
      sort_order: schema.menuItems.sort_order,
      preparation_time_min: schema.menuItems.preparation_time_min,
      allergens: schema.menuItems.allergens,
      dietary_tags: schema.menuItems.dietary_tags,
      spice_level: schema.menuItems.spice_level,
    })
    .from(schema.menuItems)
    .where(
      and(
        eq(schema.menuItems.organization_id, organizationId),
        eq(schema.menuItems.branch_id, branchId),
        inArray(schema.menuItems.category_id, categoryIds),
        isNull(schema.menuItems.deleted_at),
      ),
    )
    .orderBy(asc(schema.menuItems.sort_order), asc(schema.menuItems.name));

  const itemIds = items.map((it) => it.id);
  let withModifiers = new Set<string>();
  if (itemIds.length > 0) {
    const links = await db
      .select({ item_id: schema.menuItemModifierGroups.item_id })
      .from(schema.menuItemModifierGroups)
      .where(inArray(schema.menuItemModifierGroups.item_id, itemIds));
    withModifiers = new Set(links.map((l) => l.item_id));
  }

  const categoryById = new Map(categories.map((cat) => [cat.id, cat]));

  // El orden de las categorías manda: así la referencia `1` es el primer plato
  // de la primera categoría, y las instrucciones se leen en el mismo orden que
  // la carta impresa.
  const ordered = [...items].sort((a, b) => {
    const catA = categoryById.get(a.category_id)?.sort_order ?? 0;
    const catB = categoryById.get(b.category_id)?.sort_order ?? 0;
    if (catA !== catB) return catA - catB;
    return a.sort_order - b.sort_order;
  });

  return ordered.map((item, index) => ({
    ref: String(index + 1),
    id: item.id,
    name: item.name,
    price: item.price,
    categoryId: item.category_id,
    categoryName: categoryById.get(item.category_id)?.name ?? "",
    available: item.is_available,
    hasModifiers: withModifiers.has(item.id),
    // Campos que solo viajan al prompt, no al cliente (que ya tiene la carta).
    description: item.description,
    allergens: item.allergens ?? [],
    dietaryTags: item.dietary_tags ?? [],
    spiceLevel: item.spice_level,
    prepTimeMin: item.preparation_time_min,
  }));
}

/** Bloque de carta que se inserta en las instrucciones. */
function renderMenu(catalog: VoiceCatalogItem[], currency: string): string {
  if (catalog.length === 0) return "La carta está vacía. Discúlpate y avisa que llamarás a un mozo.";

  if (catalog.length > MAX_ITEMS_IN_PROMPT) {
    const categories = [...new Set(catalog.map((it) => it.categoryName))];
    return [
      `La carta tiene ${catalog.length} platos, demasiados para listarlos aquí.`,
      `Categorías: ${categories.join(", ")}.`,
      "Usa SIEMPRE `buscar_platos` antes de mencionar cualquier plato: no te sabes la carta de memoria.",
    ].join("\n");
  }

  const lines: string[] = [];
  let currentCategory = "";
  for (const item of catalog) {
    if (item.categoryName !== currentCategory) {
      currentCategory = item.categoryName;
      lines.push(`\n## ${currentCategory}`);
    }
    const parts = [`[${item.ref}] ${item.name} — ${formatMoney(item.price, currency)}`];
    if (!item.available) parts.push("AGOTADO HOY");
    if (item.description) parts.push(item.description.slice(0, 120));
    if (item.allergens.length) parts.push(`contiene: ${item.allergens.join(",")}`);
    if (item.dietaryTags.length) parts.push(item.dietaryTags.join(","));
    if (item.spiceLevel) parts.push(`picante ${item.spiceLevel}/3`);
    if (item.prepTimeMin) parts.push(`${item.prepTimeMin} min`);
    if (item.hasModifiers) parts.push("tiene opciones");
    lines.push(`- ${parts.join(" · ")}`);
  }
  return lines.join("\n");
}

export interface BuildInstructionsParams {
  branchName: string;
  currency: string;
  customerName?: string | null;
  tableNumber?: number | null;
  catalog: VoiceCatalogItem[];
}

/**
 * Instrucciones del mesero.
 *
 * Dos reglas cargan con casi todo el peso del producto:
 *
 *  - **Mostrar antes de nombrar.** Toda la sensación de "la pantalla va con la
 *    voz" sale de que `mostrar_platos` se llame ANTES de pronunciar el nombre,
 *    no después. Dicho de otra forma, el modelo no ilustra lo que dijo: enseña
 *    y entonces habla.
 *  - **Confirmar leyendo.** El pedido se cierra por voz, así que el resumen en
 *    voz alta es la última red antes de que la comanda entre a cocina.
 */
export function buildInstructions(params: BuildInstructionsParams): string {
  const { branchName, currency, customerName, tableNumber, catalog } = params;

  return `Eres el mesero virtual de "${branchName}", un restaurante en Perú. Atiendes por voz desde una tablet${
    tableNumber ? ` en la mesa ${tableNumber}` : ""
  }.${customerName ? ` El comensal se llama ${customerName}.` : ""}

# Cómo hablas
- Español peruano, cálido y natural. Tutea. Sin formalidades acartonadas.
- **Una o dos frases por turno. Nunca más.** Después callas y esperas. Al otro
  lado hay alguien mirando una pantalla, no leyendo un folleto: si te extiendes,
  cansas y dejan de escucharte.
- **La pantalla ya enseña el plato. No lo describas.** Enseña y di lo justo:
  "El ceviche, nuestro clásico." Ya está. Solo detallas si te preguntan.
- Ofrece de UNO en UNO, o dos como mucho. Recitar cinco platos seguidos no ayuda
  a elegir: abruma.
- Cabe una frase simpática de vez en cuando —eres un mesero, no una máquina—,
  pero nunca dos seguidas ni a costa de alargar el pedido.
- No digas los precios a menos que te pregunten o que estés cerrando el pedido.
- Nada de emojis, markdown ni listas: todo lo tuyo se escucha.

# Ejemplos del tono que quiero
Bien: "Tenemos un ceviche que sale volando. ¿Te lo pongo?"
Bien: "Va uno. ¿Algo para acompañar?"
Mal: "¡Claro que sí! Te cuento que nuestro ceviche de pescado se prepara con
pescado fresco del día, marinado en limón, con cebolla roja, ají limo y
camote..." — demasiado largo, y encima la pantalla ya lo está mostrando.

# REGLA DE ORO: enseña antes de hablar
Antes de mencionar CUALQUIER plato, llama a \`mostrar_platos\` con sus
referencias. Primero la herramienta, después la frase. La pantalla acompaña tu
voz y el comensal ve aquello de lo que le hablas justo cuando se lo nombras.
Si hablas de un solo plato en detalle, usa \`enfocar_plato\`.

# Corregir el pedido
El comensal cambiará de idea, y eso es normal. Tienes una herramienta para cada
caso, úsalas en vez de improvisar:
- "quítame el ceviche" → \`quitar_del_carrito\`
- "que sean tres" → \`cambiar_cantidad\` (fija el número; NO calcules tú la resta)
- "ponle poca sal" a algo ya pedido → \`poner_nota\`
- "mejor empecemos de nuevo" → \`vaciar_carrito\`, confirmando antes

Si el mismo plato está pedido dos veces con opciones distintas, la herramienta te
lo dirá: pregunta a cuál se refiere en vez de elegir tú.

# Lo que no puedes hacer
- No inventes platos, ingredientes ni precios: solo existe lo que está abajo.
- Si algo está AGOTADO HOY, dilo con naturalidad y ofrece una alternativa.
- Si un plato "tiene opciones", llama a \`ver_detalle_plato\` y pregunta al
  comensal por ellas ANTES de agregarlo: hay opciones obligatorias.
- Si te preguntan por alergias, responde solo con lo declarado en la carta. Ante
  la duda, NO adivines: di que lo confirmas con el personal y usa \`llamar_mozo\`.
- Una indicación como "sin cebolla" es una petición a cocina, no una garantía.
  Dila como tal; no prometas que se podrá cumplir.
- No inventas descuentos ni cambias precios. Puedes aplicar un cupón que te dé
  el comensal (\`aplicar_cupon\`) o canjear sus puntos (\`canjear_recompensa\`),
  pero el importe lo decide el sistema, nunca tú.
- No prometas tiempos de espera: no los sabes. Para saber en qué va un pedido ya
  enviado usa \`estado_del_pedido\` y di solo lo que te devuelva.
- No puedes cambiar algo que ya está en cocina, ni cobrar. Para eso, y para
  cualquier cosa que se te escape, usa \`llamar_mozo\`.

# Cupones y puntos
- Solo si el comensal los saca. No ofrezcas el programa de fidelidad a alguien
  que solo quiere comer.
- Canjear puntos los GASTA aunque después no se envíe el pedido. Dilo y espera
  un sí claro antes de canjear.
- Si al leer el pedido te avisan de que el importe del cupón lo calcula la caja,
  NO des el total como definitivo: di el total sin ese descuento y avisa de que
  el cupón se aplicará al enviarlo. Y si al confirmar te devuelven un total
  distinto, dilo en voz alta.

# Cómo cierras el pedido
Cuando el comensal diga que ya está:
1. Llama a \`leer_carrito\` para saber qué hay REALMENTE (no te fíes de tu
   memoria de la conversación).
2. Lee el pedido en voz alta, plato por plato con su cantidad, y di el total.
3. Pregunta de forma directa: "¿Lo mando a cocina?".
4. Solo si la respuesta es un sí CLARO, llama a \`confirmar_pedido\` con el
   total exacto que acabas de leer.

Si no entendiste bien la respuesta, si hubo ruido, o si el comensal dijo algo
ambiguo, PREGUNTA OTRA VEZ. Nunca confirmes por si acaso: al otro lado hay una
cocina que se pone a cocinar de verdad.

# La carta de hoy
Cada plato lleva su referencia entre corchetes. Úsala en las herramientas.
${renderMenu(catalog, currency)}

# Al empezar
Saluda en una frase, preséntate como el mesero del local y pregunta qué le
provoca. Si no sabe qué pedir, ofrece lo más representativo de la carta
—mostrándolo primero, como siempre—.`;
}

/**
 * Herramientas del agente.
 *
 * Las descripciones están redactadas para el modelo, no para un humano: dicen
 * CUÁNDO usar cada una, porque es la parte que el modelo se salta si no se le
 * insiste.
 */
export const VOICE_TOOLS: VoiceToolDefinition[] = [
  {
    name: "mostrar_platos",
    description:
      "Muestra platos en la pantalla. Llámala ANTES de nombrar cualquier plato en voz alta, nunca después. Acepta de 1 a 6 platos.",
    parameters: {
      type: "object",
      properties: {
        refs: {
          type: "array",
          items: { type: "string" },
          description: "Referencias de los platos, tal como aparecen entre corchetes en la carta.",
        },
        titulo: {
          type: "string",
          description: "Rótulo breve para la pantalla, p. ej. 'Nuestros ceviches'.",
        },
      },
      required: ["refs"],
    },
  },
  {
    name: "enfocar_plato",
    description:
      "Lleva un plato al centro de la pantalla, en grande. Úsala cuando vayas a hablar de UN plato en detalle.",
    parameters: {
      type: "object",
      properties: {
        ref: { type: "string", description: "Referencia del plato." },
      },
      required: ["ref"],
    },
  },
  {
    name: "buscar_platos",
    description:
      "Busca en la carta por texto, categoría o restricción alimentaria. Úsala cuando el comensal pida algo por características ('algo sin gluten', 'un pescado') en vez de por nombre.",
    parameters: {
      type: "object",
      properties: {
        consulta: { type: "string", description: "Texto libre: nombre, ingrediente o antojo." },
        categoria: { type: "string", description: "Nombre de la categoría." },
        sin_alergeno: {
          type: "array",
          items: { type: "string" },
          description: "Alérgenos a excluir, p. ej. ['gluten','mariscos'].",
        },
        etiqueta: {
          type: "string",
          description: "Etiqueta dietética: vegetariano, vegano, sin_gluten, sin_lactosa, keto.",
        },
        solo_disponibles: { type: "boolean", description: "Excluir los agotados." },
      },
      required: [],
    },
  },
  {
    name: "ver_detalle_plato",
    description:
      "Devuelve la descripción completa y las opciones (guarniciones, término, extras) de un plato. OBLIGATORIA antes de agregar un plato marcado como 'tiene opciones'.",
    parameters: {
      type: "object",
      properties: {
        ref: { type: "string", description: "Referencia del plato." },
      },
      required: ["ref"],
    },
  },
  {
    name: "agregar_al_carrito",
    description:
      "Agrega un plato al pedido. Los modificadores se pasan por su NOMBRE exacto, tal como los devolvió ver_detalle_plato.",
    parameters: {
      type: "object",
      properties: {
        ref: { type: "string", description: "Referencia del plato." },
        cantidad: { type: "integer", description: "Cuántas unidades. Por defecto 1.", minimum: 1 },
        modificadores: {
          type: "array",
          items: { type: "string" },
          description: "Nombres de las opciones elegidas.",
        },
        notas: {
          type: "string",
          description: "Indicación para cocina, p. ej. 'sin cebolla'. Solo si el comensal la pidió.",
        },
      },
      required: ["ref"],
    },
  },
  {
    name: "quitar_del_carrito",
    description: "Quita un plato del pedido, entero o reduciendo su cantidad.",
    parameters: {
      type: "object",
      properties: {
        ref: { type: "string", description: "Referencia del plato." },
        cantidad: {
          type: "integer",
          description: "Unidades a quitar. Si se omite, se quita la línea completa.",
          minimum: 1,
        },
        opciones: {
          type: "array",
          items: { type: "string" },
          description:
            "Opciones de la variante concreta, si el mismo plato está pedido más de una vez con opciones distintas.",
        },
      },
      required: ["ref"],
    },
  },
  {
    name: "cambiar_cantidad",
    description:
      "Fija cuántas unidades de un plato quedan en el pedido. Úsala cuando el comensal corrija un número ('que sean tres'): NO calcules tú la diferencia. Con 0 se quita del pedido.",
    parameters: {
      type: "object",
      properties: {
        ref: { type: "string", description: "Referencia del plato." },
        cantidad: { type: "integer", description: "Cantidad final que debe quedar.", minimum: 0 },
        opciones: {
          type: "array",
          items: { type: "string" },
          description: "Opciones de la variante concreta, si hay más de una del mismo plato.",
        },
      },
      required: ["ref", "cantidad"],
    },
  },
  {
    name: "poner_nota",
    description:
      "Cambia la indicación para cocina de un plato YA agregado, p. ej. 'poca sal' o 'sin cebolla'. Para reemplazarla por nada, manda la nota vacía.",
    parameters: {
      type: "object",
      properties: {
        ref: { type: "string", description: "Referencia del plato." },
        notas: { type: "string", description: "La indicación, tal como la dijo el comensal." },
        opciones: {
          type: "array",
          items: { type: "string" },
          description: "Opciones de la variante concreta, si hay más de una del mismo plato.",
        },
      },
      required: ["ref", "notas"],
    },
  },
  {
    name: "vaciar_carrito",
    description:
      "Borra el pedido entero. Solo si el comensal lo pide claramente ('empecemos de nuevo', 'bórralo todo'). Confirma antes de usarla.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "aplicar_cupon",
    description:
      "Valida y aplica un cupón de descuento al pedido. Úsala cuando el comensal mencione un código promocional. Si el cupón aún no aplica (p. ej. falta pedido mínimo) se queda puesto y entra solo al llegar al importe.",
    parameters: {
      type: "object",
      properties: {
        codigo: { type: "string", description: "El código, tal como lo dictó el comensal." },
      },
      required: ["codigo"],
    },
  },
  {
    name: "quitar_cupon",
    description: "Quita el cupón aplicado al pedido.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "ver_mis_puntos",
    description:
      "Consulta los puntos de fidelidad del comensal y qué recompensas puede canjear. Solo si él saca el tema: no ofrezcas el programa sin que pregunte.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "canjear_recompensa",
    description:
      "Canjea una recompensa por puntos y la aplica al pedido. GASTA los puntos de forma irreversible, aunque el pedido no llegue a enviarse: pregúntale y espera un sí claro ANTES de llamarla.",
    parameters: {
      type: "object",
      properties: {
        recompensa: {
          type: "string",
          description: "Nombre de la recompensa, tal como la devolvió ver_mis_puntos.",
        },
      },
      required: ["recompensa"],
    },
  },
  {
    name: "estado_del_pedido",
    description:
      "Consulta en qué va lo que ya se mandó a cocina. Úsala cuando pregunten '¿cuánto falta?' o '¿ya salió?'.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "llamar_mozo",
    description:
      "Avisa a una persona del salón. Úsala cuando el comensal quiera la cuenta, pida ayuda, pregunte algo que no está en la carta, o cuando algo falle y no puedas resolverlo tú.",
    parameters: {
      type: "object",
      properties: {
        motivo: {
          type: "string",
          enum: ["cuenta", "ayuda"],
          description: "'cuenta' para pedir la cuenta; 'ayuda' para cualquier otra cosa.",
        },
      },
      required: ["motivo"],
    },
  },
  {
    name: "leer_carrito",
    description:
      "Devuelve el pedido real con cantidades y total. Llámala antes de resumir el pedido en voz alta: es la única fuente fiable, tu memoria de la conversación no lo es.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "confirmar_pedido",
    description:
      "Envía el pedido a cocina. Solo después de haber leído el resumen en voz alta y recibido un sí claro. El total debe ser EXACTAMENTE el que acabas de decir; si no coincide, la llamada se rechaza y tendrás que volver a leer el pedido.",
    parameters: {
      type: "object",
      properties: {
        total_esperado_centimos: {
          type: "integer",
          description: "Total del pedido en céntimos, tal como te lo devolvió leer_carrito.",
        },
      },
      required: ["total_esperado_centimos"],
    },
  },
];

/** Arma el contexto completo del agente para una sesión de mesa. */
export async function buildVoiceAgentContext(params: {
  organizationId: string;
  branchId: string;
  branchName: string;
  currency: string;
  customerName?: string | null;
  tableNumber?: number | null;
}): Promise<VoiceAgentContext> {
  const catalog = await loadVoiceCatalog(params.organizationId, params.branchId);

  return {
    instructions: buildInstructions({
      branchName: params.branchName,
      currency: params.currency,
      customerName: params.customerName,
      tableNumber: params.tableNumber,
      catalog,
    }),
    // Al cliente solo le viaja lo que necesita para traducir `ref → uuid`; la
    // descripción y los alérgenos ya los tiene de la carta que cargó.
    catalog: catalog.map((it) => ({
      ref: it.ref,
      id: it.id,
      name: it.name,
      price: it.price,
      categoryId: it.categoryId,
      categoryName: it.categoryName,
      available: it.available,
      hasModifiers: it.hasModifiers,
    })),
    tools: VOICE_TOOLS,
  };
}
