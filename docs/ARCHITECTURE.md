# Arquitectura (hexagonal / puertos y adaptadores)

La API separa **interfaz**, **implementación** e **infraestructura** para que el
mismo código corra en contenedor o en serverless/edge, eligiendo adaptadores por
entorno — sin tocar el dominio ni el HTTP.

```
apps/api/src/
├── app.ts                       # Interfaz HTTP: la app Hono (agnóstica del runtime)
├── routes/                      # Controladores HTTP → dependen de PUERTOS, no de adaptadores
├── services/                    # Lógica de aplicación/dominio
│
├── core/ports/                  # ── INTERFACES (puertos) ──
│   ├── realtime.ts              #   RealtimePublisher.publish(room, data)
│   └── password-hasher.ts       #   PasswordHasher.hash/verify
│
├── infrastructure/              # ── IMPLEMENTACIONES (adaptadores) ──
│   ├── container.ts             #   Composition root: registro + fachadas (realtime, passwordHasher)
│   ├── realtime/
│   │   ├── bun-redis.adapter.ts #   WebSockets de Bun + pub/sub Redis (contenedor)
│   │   ├── pusher.adapter.ts    #   Proveedor Pusher Channels (REST firmado)
│   │   ├── ably.adapter.ts      #   Proveedor Ably (REST + TokenRequest)
│   │   ├── noop.adapter.ts      #   No-op (default serverless/edge)
│   │   └── factory.ts           #   Selección por REALTIME_PROVIDER
│   └── security/
│       ├── argon2.adapter.ts    #   argon2 nativo (contenedor/Node)
│       └── webcrypto.adapter.ts #   PBKDF2 WebCrypto puro (edge/Workers/Vercel)
│
└── runtime/ + index.ts          # ── ENTRYPOINTS (composition roots por runtime) ──
    ├── index.ts                 #   Bun (contenedor): Bun.serve + inyecta argon2 + bun-redis
    └── runtime/serverless.ts    #   Edge/serverless: misma app Hono + adaptadores puros por defecto
```

## Regla de dependencias

`routes` / `services` → **`core/ports`** (interfaces). Nunca importan un adaptador
concreto. La fachada estable vive en `infrastructure/container.ts`:

```ts
import { realtime } from "../infrastructure/container.js";
await realtime.publish(`branch:${id}`, payload);   // no sabe si es Bun+Redis o no-op
```

```ts
import { passwordHasher } from "../infrastructure/container.js";  // vía lib/hash.ts
```

## Quién inyecta qué (composition root)

Cada entrypoint elige los adaptadores al arrancar:

| Runtime | realtime | hashing | DB driver |
|---------|----------|---------|-----------|
| **Bun / contenedor** (`index.ts`) | `createRealtimeProvider()` por `REALTIME_PROVIDER` (websocket/pusher/ably) | `Argon2Hasher` | `postgres-js` |
| **Edge / serverless** (`runtime/serverless.ts`) | `NoopRealtime` (default) | `WebCryptoHasher` (default) | `neon` |

Los **defaults** del `container.ts` son los adaptadores puros, así que importar el
core es seguro en cualquier runtime (no arrastra Redis ni binarios nativos). El
entrypoint de Bun sobrescribe con los nativos vía `useRealtime()` / `useHasher()`.

> La base de datos sigue el mismo patrón en [`@restai/db`](../packages/db): el driver
> (`postgres-js` ↔ `neon`) se elige por `DATABASE_DRIVER`/autodetección.

## Proveedores de realtime (intercambiables)

El tiempo real es un **puerto con varios proveedores**, seleccionable con
`REALTIME_PROVIDER` (`websocket` | `pusher` | `ably` | `noop`) — sin tocar el
dominio ni las rutas, que solo usan `realtime.publish(room, data)`.

| Proveedor | Entrega | Config | Cliente |
|-----------|---------|--------|---------|
| `websocket` (default) | WS de Bun + Redis pub/sub | `REDIS_URL` | conecta a `/ws?token=` |
| `pusher` | REST firmada a Pusher | `PUSHER_APP_ID/KEY/SECRET/CLUSTER` | SDK Pusher + `/api/realtime/auth` |
| `ably` | REST a Ably | `ABLY_API_KEY` | SDK Ably + `/api/realtime/auth` (TokenRequest) |
| `noop` | — (sin tiempo real) | — | — |

El cliente descubre el proveedor activo y su config pública (sin secretos) en
**`GET /api/realtime/config`**, y autoriza canales privados —acotados a las salas
del usuario (multi-tenant)— en **`POST /api/realtime/auth`**. La firma/expedición
de tokens vive en cada adaptador (`authorize`), no en el dominio.

Para Pusher las salas `branch:<id>` se mapean a canales `private-branch-<id>`
(Pusher no admite `:`); Ably las usa tal cual.

## Añadir un nuevo adaptador

1. Implementa el puerto (`core/ports/*`).
2. Crea el adaptador en `infrastructure/*`.
3. Inyéctalo en el entrypoint del runtime correspondiente con `useXxx(...)`.

Nada en `routes/` ni `services/` cambia.
