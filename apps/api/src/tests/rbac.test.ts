import { describe, it, expect } from "bun:test";
import {
  PERMISSIONS,
  ROLES,
  ORDER_STATUS_TRANSITIONS,
  KITCHEN_BACK_TRANSITIONS,
  type Role,
} from "@restai/config";

/**
 * Matriz de permisos.
 *
 * Estos tests fijan las decisiones que costaron dos bloqueantes de venta:
 * el cajero abría el POS y veía un restaurante SIN PRODUCTOS (le faltaba
 * `menu:read`), y el mozo llegaba a teclear el efectivo recibido para acabar en
 * "Sin permisos" (le faltaba `payments:create`). No son preferencias de estilo:
 * cada aserción describe algo que un empleado real necesita para trabajar, o
 * algo que NO debe poder hacer.
 */

/** Réplica de la resolución de requirePermission (middleware/rbac.ts). */
function can(role: Role, permission: string): boolean {
  const granted = PERMISSIONS[role] as readonly string[];
  if (granted.includes("*")) return true;
  const [resource] = permission.split(":");
  return granted.some((p) => p === permission || p === `${resource}:*`);
}

describe("matriz de permisos — lo que cada rol NECESITA para trabajar", () => {
  it("el cajero puede ver la carta (sin esto el POS abre vacío)", () => {
    expect(can("cashier", "menu:read")).toBe(true);
  });

  it("el cajero puede cobrar, anular un cobro y cuadrar la caja", () => {
    expect(can("cashier", "payments:create")).toBe(true);
    expect(can("cashier", "payments:void")).toBe(true);
    expect(can("cashier", "cash:manage")).toBe(true);
    expect(can("cashier", "cash:read")).toBe(true);
  });

  it("el cajero puede atender 'quiero usar mis puntos' y asignar repartidor", () => {
    expect(can("cashier", "loyalty:read")).toBe(true);
    expect(can("cashier", "loyalty:redeem")).toBe(true);
    expect(can("cashier", "staff:read")).toBe(true);
  });

  it("el mozo puede cobrar en mesa: es la definición de su trabajo", () => {
    expect(can("waiter", "payments:create")).toBe(true);
    expect(can("waiter", "payments:read")).toBe(true);
  });

  it("el mozo ve en qué sede trabaja y puede identificar al cliente", () => {
    expect(can("waiter", "branch:read")).toBe(true);
    expect(can("waiter", "customers:read")).toBe(true);
    expect(can("waiter", "customers:create")).toBe(true);
  });

  it("la cocina puede avanzar comandas y anular un plato agotado", () => {
    expect(can("kitchen", "orders:update_status")).toBe(true);
    expect(can("kitchen", "orders:update_item_status")).toBe(true);
    expect(can("kitchen", "menu:availability")).toBe(true);
    expect(can("kitchen", "inventory:read")).toBe(true);
  });
});

describe("matriz de permisos — lo que cada rol NO debe poder hacer", () => {
  it("la cocina NO puede anular una venta ni revertir puntos", () => {
    // `orders:void` es deliberadamente distinto de `orders:update`: la cocina
    // avanza estados, pero no toca el dinero ni la fidelidad de una venta cerrada.
    expect(can("kitchen", "orders:void")).toBe(false);
    expect(can("kitchen", "orders:update")).toBe(false);
  });

  it("la cocina NO puede cobrar, ver reportes ni tocar la caja", () => {
    expect(can("kitchen", "payments:create")).toBe(false);
    expect(can("kitchen", "reports:read")).toBe(false);
    expect(can("kitchen", "cash:read")).toBe(false);
  });

  it("el mozo NO puede borrar mesas ni reescribir el plano del local", () => {
    // Antes ambas cosas colgaban de `tables:update`, que el mozo sí tiene: el
    // rol más numeroso podía borrar la configuración de la sala.
    expect(can("waiter", "tables:update")).toBe(true);
    expect(can("waiter", "tables:delete")).toBe(false);
    expect(can("waiter", "tables:layout")).toBe(false);
  });

  it("el mozo NO puede anular cobros, abrir caja ni ver reportes", () => {
    expect(can("waiter", "payments:void")).toBe(false);
    expect(can("waiter", "cash:manage")).toBe(false);
    expect(can("waiter", "reports:read")).toBe(false);
  });

  it("el mozo emite comprobantes pero NO los anula ante SUNAT", () => {
    // La anulación fiscal y la nota de crédito colgaban de `invoices:create`,
    // el mismo verbo que el mozo necesita para emitir la boleta de su mesa: con
    // eso podía dar de baja un comprobante YA ACEPTADO por SUNAT. Es la misma
    // separación que ya existía para `orders:void` y `payments:void`.
    expect(can("waiter", "invoices:create")).toBe(true);
    expect(can("waiter", "invoices:void")).toBe(false);
  });

  it("quien corrige la venta en el mostrador sí puede anular comprobantes", () => {
    expect(can("cashier", "invoices:void")).toBe(true);
    expect(can("branch_manager", "invoices:void")).toBe(true);
    expect(can("org_admin", "invoices:void")).toBe(true);
  });

  it("la cocina no toca comprobantes", () => {
    expect(can("kitchen", "invoices:create")).toBe(false);
    expect(can("kitchen", "invoices:void")).toBe(false);
  });

  it("el cajero NO puede ver reportes de negocio ni la auditoría", () => {
    expect(can("cashier", "reports:read")).toBe(false);
    expect(can("cashier", "audit:read")).toBe(false);
  });

  it("el gerente de sede NO puede cambiar la configuración de la organización", () => {
    expect(can("branch_manager", "settings:read")).toBe(true);
    expect(can("branch_manager", "settings:update")).toBe(false);
    expect(can("branch_manager", "org:update")).toBe(false);
  });

  it("solo los roles de gestión leen la auditoría", () => {
    expect(can("org_admin", "audit:read")).toBe(true);
    expect(can("branch_manager", "audit:read")).toBe(true);
    expect(can("waiter", "audit:read")).toBe(false);
    expect(can("kitchen", "audit:read")).toBe(false);
  });

  it("solo el admin de organización configura la facturación electrónica", () => {
    expect(can("org_admin", "sunat:update")).toBe(true);
    expect(can("branch_manager", "sunat:read")).toBe(true);
    expect(can("branch_manager", "sunat:update")).toBe(false);
    expect(can("cashier", "sunat:read")).toBe(false);
  });
});

describe("matriz de permisos — coherencia general", () => {
  it("todos los roles declarados tienen permisos definidos", () => {
    for (const role of Object.keys(ROLES) as Role[]) {
      expect(PERMISSIONS[role]).toBeDefined();
      expect((PERMISSIONS[role] as readonly string[]).length).toBeGreaterThan(0);
    }
  });

  it("solo super_admin tiene el comodín total", () => {
    for (const role of Object.keys(ROLES) as Role[]) {
      const granted = PERMISSIONS[role] as readonly string[];
      expect(granted.includes("*")).toBe(role === "super_admin");
    }
  });

  it("todo rol operativo puede leer la carta: sin ella no se puede trabajar", () => {
    for (const role of ["cashier", "waiter", "kitchen", "branch_manager", "org_admin"] as Role[]) {
      expect(can(role, "menu:read")).toBe(true);
    }
  });

  it("todo rol operativo sabe en qué sede está", () => {
    for (const role of ["cashier", "waiter", "kitchen", "branch_manager", "org_admin"] as Role[]) {
      expect(can(role, "branch:read")).toBe(true);
    }
  });

  it("todo rol operativo puede LEER la configuración de su sede", () => {
    // El layout pinta el nombre y el logo del local en TODAS las pantallas, y el
    // interruptor de "cada mozo ve solo sus mesas" vive en branches.settings.
    // Sin este permiso, cada carga de cualquier pantalla devolvía un 403 y el
    // filtrado por asignación quedaba desactivado en silencio para los mozos.
    for (const role of ["cashier", "waiter", "kitchen", "branch_manager", "org_admin"] as Role[]) {
      expect(can(role, "settings:read")).toBe(true);
    }
  });

  it("pero NINGÚN rol operativo puede ESCRIBIR la configuración", () => {
    for (const role of ["cashier", "waiter", "kitchen", "branch_manager"] as Role[]) {
      expect(can(role, "settings:update")).toBe(false);
    }
    expect(can("org_admin", "settings:update")).toBe(true);
  });
});

/**
 * Máquina de estados de la comanda.
 *
 * El tablero de cocina ofrece un botón para devolver una comanda al paso
 * anterior. Estos tests garantizan dos cosas a la vez: que ese botón nunca puede
 * proponer un movimiento que el servidor rechazaría, y que la marcha atrás se
 * detiene justo donde empiezan los efectos contables.
 */
describe("máquina de estados — retroceso en el tablero de cocina", () => {
  it("cada retroceso declarado es una transición válida de verdad", () => {
    for (const [from, to] of Object.entries(KITCHEN_BACK_TRANSITIONS)) {
      expect(ORDER_STATUS_TRANSITIONS[from]).toContain(to);
    }
  });

  it("se puede retroceder dentro del ciclo de cocina", () => {
    expect(KITCHEN_BACK_TRANSITIONS.preparing).toBe("pending");
    expect(KITCHEN_BACK_TRANSITIONS.ready).toBe("preparing");
    expect(KITCHEN_BACK_TRANSITIONS.served).toBe("ready");
  });

  it("NO se retrocede desde los estados con efectos contables", () => {
    // `completed` disparó inventario, puntos y cierre de la venta; `cancelled`
    // revirtió cupón y canje. Deshacer eso con un toque desde la cocina dejaría
    // el stock y la fidelidad descuadrados sin ninguna traza.
    expect(KITCHEN_BACK_TRANSITIONS.completed).toBeUndefined();
    expect(KITCHEN_BACK_TRANSITIONS.cancelled).toBeUndefined();
    expect(ORDER_STATUS_TRANSITIONS.completed).toEqual([]);
    expect(ORDER_STATUS_TRANSITIONS.cancelled).toEqual([]);
  });

  it("el avance normal del pase sigue intacto", () => {
    expect(ORDER_STATUS_TRANSITIONS.pending).toContain("preparing");
    expect(ORDER_STATUS_TRANSITIONS.preparing).toContain("ready");
    expect(ORDER_STATUS_TRANSITIONS.ready).toContain("served");
    expect(ORDER_STATUS_TRANSITIONS.served).toContain("completed");
  });

  it("se puede cancelar mientras la comanda siga viva en cocina", () => {
    for (const from of ["pending", "confirmed", "preparing"]) {
      expect(ORDER_STATUS_TRANSITIONS[from]).toContain("cancelled");
    }
  });
});
