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
│   │   └── noop.adapter.ts      #   No-op (default serverless/edge)
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
| **Bun / contenedor** (`index.ts`) | `WebSocketManager` (Bun WS + Redis) | `Argon2Hasher` | `postgres-js` |
| **Edge / serverless** (`runtime/serverless.ts`) | `NoopRealtime` (default) | `WebCryptoHasher` (default) | `neon` |

Los **defaults** del `container.ts` son los adaptadores puros, así que importar el
core es seguro en cualquier runtime (no arrastra Redis ni binarios nativos). El
entrypoint de Bun sobrescribe con los nativos vía `useRealtime()` / `useHasher()`.

> La base de datos sigue el mismo patrón en [`@restai/db`](../packages/db): el driver
> (`postgres-js` ↔ `neon`) se elige por `DATABASE_DRIVER`/autodetección.

## Añadir un nuevo adaptador

1. Implementa el puerto (`core/ports/*`).
2. Crea el adaptador en `infrastructure/*`.
3. Inyéctalo en el entrypoint del runtime correspondiente con `useXxx(...)`.

Nada en `routes/` ni `services/` cambia.
