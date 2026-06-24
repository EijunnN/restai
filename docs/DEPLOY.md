# Despliegue

RestAI está diseñado para correr **con la misma base de código** de varias formas,
eligiendo por configuración (variables de entorno + entrypoint de deploy), sin
modificar el código de la aplicación.

## Por qué la API necesita un contenedor (y no Workers/Vercel "puros")

La API usa cuatro piezas que requieren un runtime Node/Bun completo y de larga
duración:

- `@node-rs/argon2` — hashing de contraseñas (binario nativo).
- **WebSockets nativos de Bun** — actualizaciones en vivo de cocina/órdenes.
- `ioredis` — pub/sub para esos WebSockets entre instancias.
- `postgres-js` — Postgres por TCP (configurable, ver abajo).

Estas no corren en Cloudflare Workers / Vercel Functions (serverless puro) sin
reescribirlas. Por eso **la API se despliega como imagen Docker**, que sí corre
igual en un VPS, en Railway/Render/Fly y en **Cloudflare Containers**.

El **dashboard web** (Next.js) sí es serverless y va en Vercel o Cloudflare Pages.

## Capa de datos: portable por entorno

`@restai/db` elige el driver con `DATABASE_DRIVER`:

| Valor | Uso |
|-------|-----|
| `postgres-js` (default) | TCP clásico — contenedor, Postgres local, Neon por TCP |
| `neon` | Driver serverless de Neon (HTTP/WebSocket) |

Si no se define, se autodetecta: una `DATABASE_URL` con host `*.neon.tech` usa
`neon`; cualquier otra usa `postgres-js`. **El mismo código funciona con ambos.**

> Base ya provista: existe un proyecto Neon `restai` con las migraciones aplicadas
> (incluida la de SUNAT). Solo hay que apuntar `DATABASE_URL` a su connection string.

---

## Modo A — Contenedor (como está hoy)

Vale para docker-compose local, Contabo/Coolify, Railway, Render o Fly. Levanta
api + web + postgres + redis y aplica migraciones automáticamente:

```bash
cp .env.example .env   # completar JWT_*, SUNAT_ENCRYPTION_KEY, etc.
docker compose up -d
```

En PaaS (Railway/Render/Fly): build con `Dockerfile.api` (API) y `Dockerfile.web`
(web), Postgres → Neon, Redis → add-on o Upstash (`rediss://...`).

## Modo B — Cloudflare

### B.1 Worker serverless (sin contenedor) — **opción por defecto**

La API corre como **Cloudflare Worker** (sin Docker ni plan Containers). Posible
porque el realtime se delega a Pusher/Ably (no hay WebSockets propios), el hashing
usa WebCrypto, la DB usa el driver serverless de Neon **por-request**
(`AsyncLocalStorage`) y el cron de sesiones es un **Cron Trigger**.

- Config: [`deploy/cloudflare-worker/`](../deploy/cloudflare-worker) + workflow
  [`deploy-api.yml`](../.github/workflows/deploy-api.yml) (push a `main`).
- Realtime: pon `REALTIME_PROVIDER=ably` (o `pusher`) en `wrangler.toml` y añade el
  secreto (`wrangler secret put ABLY_API_KEY`). Con `noop` la app va sin tiempo real.
- Requiere `DATABASE_DRIVER=neon` (ya fijado en el `wrangler.toml`).

### B.2 Containers (proceso completo, escala a cero)

- **API → Cloudflare Containers** (corre `Dockerfile.api` sin cambios). El scaffold
  está en [`deploy/cloudflare/`](../deploy/cloudflare): un Worker mínimo + Durable
  Object que enruta hacia el contenedor.

  **Despliegue por CI/CD (recomendado):** el workflow
  [`.github/workflows/deploy-api.yml`](../.github/workflows/deploy-api.yml) aplica
  migraciones en Neon y hace `wrangler deploy` en cada push a `main`. El runner de
  GitHub Actions ya trae Docker, así que **construye y sube la imagen en CI** — no
  hace falta Docker local. Secretos del repo: `CLOUDFLARE_API_TOKEN`,
  `CLOUDFLARE_ACCOUNT_ID`, `DATABASE_URL`.

  Los secretos de la propia API se cargan **una vez** en el Worker (persisten entre
  despliegues):

  ```bash
  cd deploy/cloudflare
  bun install
  wrangler secret put DATABASE_URL          # Neon
  wrangler secret put JWT_SECRET
  wrangler secret put JWT_REFRESH_SECRET
  wrangler secret put SUNAT_ENCRYPTION_KEY
  wrangler secret put REDIS_URL             # Upstash: rediss://...
  ```

  (También puedes correr `wrangler deploy` localmente si tienes Docker; requiere el
  plan de Cloudflare con Containers habilitado.)

- **Web → Cloudflare Worker** (OpenNext). Build del `apps/web` (Next.js) con
  `NEXT_PUBLIC_API_URL` apuntando a la URL del Worker de la API. Se publica en
  `app.restai.bezenti.com` (ver `apps/web/wrangler.jsonc`).

## Puesta en marcha con CI/CD (lo que necesitas hacer)

Todo el despliegue es por GitHub Actions al hacer push a `main`:

- [`.github/workflows/deploy-api.yml`](../.github/workflows/deploy-api.yml) — migra Neon + despliega la API como Cloudflare Worker + sincroniza secretos.
- [`.github/workflows/deploy-web.yml`](../.github/workflows/deploy-web.yml) — build con OpenNext + despliega el web como Cloudflare Worker.

**Pasos:**

1. **Crea tu propio repo** (fork de `EijunnN/restai` o uno nuevo) y sube este código. Las Actions corren sobre tu repositorio.
2. **GitHub → Settings → Secrets and variables → Actions**, crea:

   | Secret | Para qué |
   |--------|----------|
   | `CLOUDFLARE_API_TOKEN` | API + Web (token "Claude Contabo") |
   | `CLOUDFLARE_ACCOUNT_ID` | API + Web (`39f3db3a2ce79188fddf0cb83e72f8be`) |
   | `DATABASE_URL` | API: connection string de Neon |
   | `JWT_SECRET`, `JWT_REFRESH_SECRET` | API: auth |
   | `SUNAT_ENCRYPTION_KEY` | API: cifra credenciales/cert SUNAT |
   | `REDIS_URL` | API: Upstash `rediss://…` |

   El web reutiliza `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID`; no necesita secretos propios.

3. **Web (Cloudflare)**: el `NEXT_PUBLIC_API_URL` se inyecta en build desde el propio
   workflow (`deploy-web.yml`) y el dominio se define en `apps/web/wrangler.jsonc`. No
   hace falta configurar nada más.
4. **Cloudflare**: ten habilitado Containers en tu plan de Workers.
5. **Push a `main`** → se despliega solo. (O lánzalo a mano con *Run workflow*.)

> La base Neon y el Redis de Upstash ya están creados y verificados; sus URLs están
> en mis notas privadas de tu cuenta para que las copies a los secrets.

## Servicios externos por entorno

| Servicio | Contenedor local | PaaS / Cloudflare |
|----------|-------------------|-------------------|
| Postgres | contenedor `postgres` o Neon | **Neon** (`DATABASE_DRIVER` a gusto) |
| Redis | contenedor `redis` | **Upstash** `rediss://` (ioredis lo soporta) |
| Almacenamiento (imágenes) | Cloudflare R2 (opcional) | Cloudflare R2 |

## Variables clave

- `DATABASE_URL`, `DATABASE_DRIVER` — base de datos.
- `REDIS_URL` — Redis (vacío → reintenta localhost; usar Upstash en cloud).
- `JWT_SECRET`, `JWT_REFRESH_SECRET` — auth.
- `SUNAT_ENCRYPTION_KEY` — cifra credenciales SOL y certificado SUNAT (ver
  [SUNAT.md](SUNAT.md)).
- `CORS_ORIGINS` — dominios del frontend permitidos.
