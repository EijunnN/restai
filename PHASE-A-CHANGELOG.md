# Fase A: Fixes Bloqueantes de Deploy

> Auditoría de producción realizada el 2026-02-09 con 5 agentes auditores en paralelo.
> Se encontraron 124 hallazgos totales (18 critical, 29 high, 44 medium, 33 low).
> Esta fase resuelve los 9 issues más críticos que impedían un deploy seguro.

---

## 1. JWT Secrets Hardcodeados

**Archivo:** `apps/api/src/lib/jwt.ts`

### Antes
```typescript
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "dev-refresh-secret-change-me";
```

### Que pasaba si se dejaba asi
Si el servidor arrancaba en produccion **sin las variables de entorno configuradas**, usaba silenciosamente los secrets `"dev-secret-change-me"` y `"dev-refresh-secret-change-me"`. Cualquier atacante que conociera estos valores (que estan en el codigo fuente publico) podia **forjar cualquier JWT** y hacerse pasar por cualquier usuario, admin, o cliente. Acceso total al sistema sin credenciales.

### Ahora
```typescript
if (!process.env.JWT_SECRET || !process.env.JWT_REFRESH_SECRET) {
  throw new Error("JWT_SECRET and JWT_REFRESH_SECRET environment variables are required");
}
const JWT_SECRET: string = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET: string = process.env.JWT_REFRESH_SECRET;
```

El servidor **se niega a arrancar** si las variables no estan seteadas. Crash inmediato con mensaje claro. Es imposible que corra en produccion con secrets adivinables.

---

## 2. Access Token TTL de 8 Horas

**Archivo:** `apps/api/src/lib/jwt.ts`

### Antes
```typescript
return sign({ ...payload, iat: now, exp: now + 8 * 60 * 60 }, JWT_SECRET);
```

### Que pasaba si se dejaba asi
Un token de acceso robado (via XSS, red insegura, shoulder surfing, etc.) era valido durante **8 horas completas**. El atacante tenia una ventana de 8 horas para usar ese token: ver datos de la organizacion, crear ordenes, modificar inventario, acceder a informacion de clientes. Incluso si el usuario original cerraba sesion, el token robado seguia funcionando.

### Ahora
```typescript
return sign({ ...payload, iat: now, exp: now + 15 * 60 }, JWT_SECRET);
```

El token de acceso expira en **15 minutos**. Si es robado, la ventana de ataque se reduce de 8 horas a 15 minutos. El frontend ya tiene logica de refresh token automatica que renueva el access token de forma transparente para el usuario.

---

## 3. CORS Hardcodeado a localhost

**Archivo:** `apps/api/src/app.ts`

### Antes
```typescript
app.use("*", cors({ origin: ["http://localhost:3000"], credentials: true }));
```

### Que pasaba si se dejaba asi
Dos escenarios igualmente malos:
1. **En produccion con el dominio real**: Todas las requests del frontend eran bloqueadas por CORS porque el origin no era `localhost:3000`. La aplicacion completa dejaba de funcionar.
2. **Si se "arreglaba" con `origin: "*"`**: Cualquier sitio web malicioso podia hacer requests al API con las credenciales del usuario (cookies, tokens). Un atacante podia crear `restaurante-falso.com` que llamara al API real y robara datos.

### Ahora
```typescript
const CORS_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",")
  : ["http://localhost:3000"];
app.use("*", cors({ origin: CORS_ORIGINS, credentials: true }));
```

Los origenes permitidos se configuran via variable de entorno `CORS_ORIGINS` (separados por coma). En desarrollo funciona con `localhost:3000` por defecto. En produccion se setea `CORS_ORIGINS=https://app.mirestaurante.pe` y solo ese dominio puede hacer requests.

---

## 4. Token de Sesion Expuesto en Endpoint Publico

**Archivo:** `apps/api/src/routes/customer.ts` (endpoint `GET /:branchSlug/:tableCode/check-session`)

### Antes
```typescript
const [activeSession] = await db.select({
  id: schema.tableSessions.id,
  status: schema.tableSessions.status,
  customer_name: schema.tableSessions.customer_name,
  token: schema.tableSessions.token,         // <-- JWT completo
}).from(schema.tableSessions)...

return c.json({
  success: true,
  data: {
    hasSession: true,
    status: "active",
    sessionId: activeSession.id,
    customerName: activeSession.customer_name,
    token: activeSession.token,               // <-- Enviado a cualquiera
  },
});
```

### Que pasaba si se dejaba asi
Este endpoint es **publico** (no requiere autenticacion). Cualquier persona que conociera el slug de la sucursal y el codigo QR de una mesa (impreso fisicamente en la mesa) podia llamar a `GET /api/customer/mi-restaurante/MESA01/check-session` y obtener el **JWT completo** del cliente sentado en esa mesa. Con ese token podia:
- Hacer pedidos a nombre del cliente
- Llamar al mozo como si fuera el cliente
- Pedir la cuenta
- Acceder al perfil de loyalty y ver sus puntos/ordenes
- Canjear recompensas del cliente

### Ahora
```typescript
const [activeSession] = await db.select({
  id: schema.tableSessions.id,
  status: schema.tableSessions.status,
  customer_name: schema.tableSessions.customer_name,
  // token REMOVIDO del SELECT
}).from(schema.tableSessions)...

return c.json({
  success: true,
  data: {
    hasSession: true,
    status: "active",
    sessionId: activeSession.id,
    customerName: activeSession.customer_name,
    // token REMOVIDO de la respuesta
  },
});
```

El endpoint solo devuelve si hay sesion activa, su estado y el nombre del cliente. El JWT **nunca se expone**. El token solo se obtiene cuando el cliente crea la sesion el mismo (que requiere su nombre y datos).

---

## 5. WebSocket Permite Unirse a Rooms de Otras Organizaciones

**Archivo:** `apps/api/src/ws/handlers.ts`

### Antes
```typescript
case "join": {
  if (data.room) {
    await manager.joinRoom(clientId, data.room);
    ws.send(JSON.stringify({ type: "joined", room: data.room }));
  }
  break;
}
case "leave": {
  if (data.room) {
    await manager.leaveRoom(clientId, data.room);
    ws.send(JSON.stringify({ type: "left", room: data.room }));
  }
  break;
}
```

### Que pasaba si se dejaba asi
Despues de autenticarse via WebSocket, un usuario podia enviar `{"type":"join","room":"branch:UUID-DE-OTRA-ORGANIZACION"}` y **suscribirse a todos los eventos en tiempo real de otro restaurante**: pedidos nuevos, actualizaciones de cocina, llamadas de mozo, requests de cuenta, sesiones de clientes. Un competidor podia espiar toda la operacion de otro restaurante en vivo. Un atacante podia recolectar nombres de clientes, sus pedidos, y montos.

### Ahora
```typescript
case "join": {
  ws.send(JSON.stringify({ type: "error", message: "Rooms are assigned automatically on auth" }));
  break;
}
case "leave": {
  ws.send(JSON.stringify({ type: "error", message: "Room management is automatic" }));
  break;
}
```

Los rooms se asignan **automaticamente** basandose en el token JWT durante la autenticacion (handler `auth`, lineas 36-43). Un customer solo se une a su branch y mesa. Un staff solo se une a las branches que tiene asignadas en su token. No se puede unir manualmente a ningun room.

---

## 6. URLs `localhost:3001` Hardcodeadas en el Frontend del Cliente

**Archivos:** 5 paginas del customer flow (cart, status, menu, menu/[itemId], waiting)

### Antes
```typescript
// En cart/page.tsx, status/page.tsx, menu/page.tsx, etc.
const res = await fetch("http://localhost:3001/api/customer/...");
const wsUrl = "ws://localhost:3001/ws";
```

### Que pasaba si se dejaba asi
**Toda la experiencia del cliente en produccion estaba rota.** Un comensal escaneaba el QR, la pagina cargaba, pero cada llamada al API apuntaba a `localhost:3001` (que no existe en su telefono). Resultado:
- No podia ver el menu
- No podia agregar items al carrito
- No podia hacer pedidos
- No podia ver el estado de su orden
- No podia llamar al mozo ni pedir la cuenta
- El WebSocket no conectaba

Basicamente, el flujo QR completo era inutilizable fuera de la maquina del desarrollador.

### Ahora
```typescript
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

const res = await fetch(`${API_URL}/api/customer/...`);
```

Todas las URLs usan la variable de entorno `NEXT_PUBLIC_API_URL`. En desarrollo sigue funcionando con localhost. En produccion se configura `NEXT_PUBLIC_API_URL=https://api.mirestaurante.pe` y todo el flujo del cliente apunta al servidor correcto. El patron es el mismo que ya usaban el dashboard (`fetcher.ts`) y el WebSocket hook (`use-websocket.ts`).

---

## 7. Sin Error Boundaries (Pantalla Blanca en Errores)

**Archivos creados:**
- `apps/web/src/app/global-error.tsx`
- `apps/web/src/app/(dashboard)/error.tsx`
- `apps/web/src/app/(customer)/error.tsx`

### Antes
No existia ningun archivo `error.tsx` ni `global-error.tsx` en toda la aplicacion.

### Que pasaba si se dejaba asi
Cualquier error de JavaScript no manejado (un `.map()` sobre `undefined`, una propiedad inexistente en la respuesta del API, un componente que falla al renderizar) causaba una **pantalla completamente blanca** sin ninguna explicacion ni forma de recuperarse.

Escenarios reales:
- **Dashboard**: Un admin abre la pagina de reportes, la API devuelve un formato inesperado, pantalla blanca. No puede acceder a ningun otro modulo sin recargar manualmente.
- **Cliente**: Un comensal esta viendo el menu, ocurre un error de red momentaneo, pantalla blanca en su telefono. Piensa que el sistema esta caido, llama al mozo confundido.
- **Cocina**: El display de cocina tiene un error de renderizado, pantalla blanca. La cocina deja de recibir pedidos hasta que alguien recarga la pagina.

### Ahora
Tres niveles de error boundaries:

1. **`global-error.tsx`**: Captura errores a nivel raiz (incluyendo el layout principal). Muestra "Algo salio mal" con boton "Intentar de nuevo". Usa inline styles porque no puede depender de CSS que podria estar roto.

2. **`(dashboard)/error.tsx`**: Captura errores en cualquier pagina del dashboard. Muestra un mensaje limpio con el componente Button de shadcn/ui. El sidebar y navegacion siguen funcionando, el usuario puede navegar a otra seccion.

3. **`(customer)/error.tsx`**: Captura errores en el flujo del cliente (menu, carrito, estado). Muestra un mensaje amigable con boton de reintento.

En todos los casos: el error se contiene en su seccion, el usuario ve un mensaje util, y puede reintentar sin recargar la pagina manualmente.

---

## 8. Customer Store Pierde Datos al Recargar

**Archivo:** `apps/web/src/stores/customer-store.ts`

### Antes
```typescript
export const useCustomerStore = create<CustomerState>((set) => ({
  token: null,          // Siempre null al cargar
  sessionId: null,      // Siempre null al cargar
  branchSlug: null,     // Siempre null al cargar (NUNCA se persistia)
  tableCode: null,      // Siempre null al cargar (NUNCA se persistia)
  orderId: null,        // Siempre null al cargar
  branchName: null,     // Siempre null al cargar (NUNCA se persistia)
  customerName: null,   // Siempre null al cargar
  setSession: (data) => {
    set({ ... });
    // Solo persistia token, sessionId, customerName
    sessionStorage.setItem("customer_token", data.token);
    sessionStorage.setItem("customer_session_id", data.sessionId);
  },
```

### Que pasaba si se dejaba asi
Cuando un cliente recargaba la pagina (pull-to-refresh en el telefono, boton de recarga, navegacion atras/adelante):
- `branchSlug` y `tableCode` volvian a `null` porque **nunca se guardaban** en sessionStorage
- `branchName` volvia a `null`
- El header del layout mostraba "RestAI" en vez del nombre del restaurante
- El link al perfil generaba una URL invalida `/${null}/${null}/profile`
- La navegacion entre paginas del flujo customer se rompia porque los parametros de ruta dependian de estos valores

El token y sessionId se persistian parcialmente, pero el contexto de ubicacion (que restaurante, que mesa) se perdia completamente.

### Ahora
```typescript
const isBrowser = typeof window !== "undefined";
function getItem(key: string): string | null {
  return isBrowser ? sessionStorage.getItem(key) : null;
}

export const useCustomerStore = create<CustomerState>((set) => ({
  token: getItem("customer_token"),
  sessionId: getItem("customer_session_id"),
  branchSlug: getItem("customer_branch_slug"),      // Restaurado de sessionStorage
  tableCode: getItem("customer_table_code"),         // Restaurado de sessionStorage
  orderId: getItem("customer_order_id"),
  branchName: getItem("customer_branch_name"),       // Restaurado de sessionStorage
  customerName: getItem("customer_name"),
  setSession: (data) => {
    set({ ... });
    // Persiste TODOS los campos
    sessionStorage.setItem("customer_token", data.token);
    sessionStorage.setItem("customer_session_id", data.sessionId);
    sessionStorage.setItem("customer_branch_slug", data.branchSlug);
    sessionStorage.setItem("customer_table_code", data.tableCode);
    if (data.branchName) sessionStorage.setItem("customer_branch_name", data.branchName);
    if (data.customerName) sessionStorage.setItem("customer_name", data.customerName);
  },
```

Los 7 campos se inicializan desde sessionStorage al cargar. Los 7 campos se persisten cuando se setean. El clear() limpia los 7 campos. Un refresh de pagina mantiene todo el contexto del cliente intacto.

---

## 9. `.env.example` Actualizado

**Archivo:** `.env.example`

### Antes
Faltaban variables nuevas y algunas no usadas estaban listadas.

### Ahora
Incluye todas las variables requeridas por el sistema:
- `CORS_ORIGINS` (nueva, para el fix #3)
- `LOG_LEVEL` (existia en el codigo pero no en el example)
- `NEXT_PUBLIC_WS_URL` (para conexion WebSocket del cliente)
- Variables de R2 sin valores por defecto (para no commitear secrets)
- Removidas variables que no se usan (`API_URL`, `WEB_PORT`)

---

## Resumen de Impacto

| Fix | Riesgo eliminado | Severidad |
|-----|-----------------|-----------|
| JWT secrets | Forjar tokens y suplantar cualquier usuario | CRITICAL |
| Token TTL | Token robado valido por 8 horas | CRITICAL |
| CORS | App rota en produccion o vulnerable a CSRF | HIGH |
| Session token leak | Robar sesion de cualquier cliente via QR | CRITICAL |
| WebSocket rooms | Espiar operacion de cualquier restaurante | CRITICAL |
| localhost URLs | Flujo QR completo inutilizable en produccion | CRITICAL |
| Error boundaries | Pantalla blanca sin recovery en cualquier error JS | CRITICAL |
| Customer store | Contexto del cliente perdido al recargar pagina | CRITICAL |
| .env.example | Configuracion incompleta causa errores en deploy | LOW |

**Archivos modificados:** 10
**Archivos creados:** 3 (error boundaries)
**Type-check:** API + Web pasan sin errores
