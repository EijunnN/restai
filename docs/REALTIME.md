# Mensajería en tiempo real (portátil)

El realtime sigue **ports & adapters**: el dominio solo conoce el puerto
`RealtimePublisher` (`realtime.publish(room, data)`); la entrega concreta vive en
adaptadores que se eligen por entorno con `REALTIME_PROVIDER`. Añadir/cambiar de
proveedor no toca el código de negocio.

## Proveedores (`REALTIME_PROVIDER`)

| Valor | Entrega | Sirve WS propio | Dependencias |
|-------|---------|-----------------|--------------|
| `websocket` (default) | **Servidor WebSocket nativo en el mismo proceso del backend** | Sí, en `/ws` | Opcional: Redis (ver coordinador) |
| `ably` | Ably (Pub/Sub cloud) | No | `ABLY_API_KEY` |
| `pusher` | Pusher (cloud) | No | `PUSHER_*` |
| `noop` | Sin tiempo real | No | — |

Con `ably`/`pusher` la entrega corre por el proveedor cloud y `/ws` queda
deshabilitado; el cliente descubre todo vía `GET /api/realtime/config` y el hook
`use-websocket.ts` se conecta solo (es agnóstico al proveedor).

## Provider `websocket`: in-process, con coordinador opcional

El `WebSocketManager` mantiene las conexiones **en memoria del mismo proceso** que
el HTTP de Hono. Cómo se propaga un `publish` entre instancias lo decide el
**coordinador** (`REALTIME_WS_COORDINATOR`):

| Coordinador | Cuándo | Cómo propaga |
|-------------|--------|--------------|
| `local` | Un solo proceso (VPS sencillo) | Loopback en memoria. **Sin Redis** ni nada externo. |
| `redis` | Varias instancias (contenedor escalado, Vercel) | Redis pub/sub: un `publish` en la instancia A llega a clientes WS en la instancia B. |

Selección: `REALTIME_WS_COORDINATOR=local|redis` lo fuerza; si no, se autodetecta
(`redis` cuando hay `REDIS_URL`, si no `local`). En modo `local` el módulo de
Redis ni siquiera abre conexión (es `lazyConnect`).

> **VPS típico:** `REALTIME_PROVIDER=websocket` y sin `REDIS_URL` → WebSocket real
> dentro del mismo proceso del backend, cero infraestructura extra. Si más
> adelante escalas a varias réplicas, añade `REDIS_URL` y pasa a coordinador
> `redis` sin cambiar código.

## Entrypoints (runtimes)

| Entrypoint | Runtime | WS nativo | Default provider |
|------------|---------|-----------|------------------|
| `src/index.ts` | **Bun** (contenedor / VPS) | `Bun.serve` | `websocket` |
| `src/server.node.ts` | **Node** (VPS Node / Vercel) | `@hono/node-server` + `ws` | `websocket` |
| `src/worker.ts` | **Cloudflare Worker** | — (sin WS persistentes) | `noop`/`ably` |

Bun y Node comparten el **mismo** `WebSocketManager` (es agnóstico al transporte:
solo asume `send`/`close`/`readyState`, que cumplen tanto el `ServerWebSocket` de
Bun como el `WebSocket` de `ws`). La lógica de salas/auth vive en
`WebSocketManager.register()`, reutilizada por ambos.

## Vercel (WebSockets)

Vercel ya sirve WebSockets en Functions ([docs](https://vercel.com/docs/functions/websockets)).
Encaja con esta arquitectura usando el entrypoint **`server.node.ts`**:

- Es WS **nativo** servido por la Function (`ws` / `@hono/node-server`), igual que
  un VPS Node — el mismo `WebSocketManager` corre sin cambios.
- **Requiere Fluid compute** (default en proyectos nuevos desde abr-2025).
- Una conexión queda **fijada a una instancia**; con varias instancias hay que
  coordinar con **Redis** → usar `REALTIME_WS_COORDINATOR=redis` + `REDIS_URL`
  (Redis del Marketplace de Vercel o Upstash). Sin Redis, dos clientes en
  instancias distintas no se verían entre sí.
- La conexión se cierra al llegar a la **duración máxima** de la Function; el hook
  del cliente ya **reconecta** automáticamente (y re-suscribe por el token).
- Estado durable (presencia, contadores, salas) debe vivir fuera de memoria — aquí
  las salas se reconstruyen del JWT en cada (re)conexión, así que no hay estado en
  memoria que perder entre instancias.
- DB: en serverless usar `DATABASE_DRIVER=neon` (driver HTTP/WebSocket por request).

**Resumen:** la infraestructura de Vercel **sí** soporta el modelo, sin cambios en
el dominio: provider `websocket` + entrypoint `server.node.ts` + coordinador
`redis`. La única diferencia con un VPS de un proceso es el coordinador (Redis en
vez de local), que es justo lo que esta capa abstrae.

## Variables

- `REALTIME_PROVIDER` — `websocket` (default) | `ably` | `pusher` | `noop`.
- `REALTIME_WS_COORDINATOR` — `local` | `redis` (solo para `websocket`; autodetecta por `REDIS_URL`).
- `REDIS_URL` — Redis para coordinación multi-instancia (Upstash `rediss://…`, etc.).
- `ABLY_API_KEY` / `PUSHER_*` — según el proveedor cloud elegido.
