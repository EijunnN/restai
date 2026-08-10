# RestAI

Sistema de gestión de restaurantes multi-tenant para el mercado peruano: toma de
pedidos, cocina, cobro, facturación electrónica ante SUNAT y carta digital por QR.

## Qué incluye

| Área | Qué resuelve |
|---|---|
| **Punto de venta** (`/pos`) | Cuentas abiertas de todo el local, ampliar una cuenta con otra ronda, cobro rápido y cobro completo (dividir, parciales) |
| **Salón** (`/tables`) | Plano editable, visitas de mesa, juntar y mover, avisos de "llama al mozo" y "la cuenta" |
| **Cocina** (`/kitchen`) | Tablero en tiempo real, anular líneas ("86"), agotar platos desde el pase |
| **Órdenes** (`/orders`) | Servicio en curso e histórico, con búsqueda y urgencias por tiempo parado |
| **Carta** (`/menu`) | Categorías y platos con arrastrar-para-ordenar, opciones y modificadores, ranking real de más vendidos |
| **Cobro** (`/payments`, `/caja`) | Cobros por orden o por producto, propinas, anulaciones, arqueo de caja por turno |
| **Facturación** (`/invoices`) | Boletas, facturas y notas de crédito declaradas ante SUNAT |
| **Comensal** (QR) | Carta digital, pedido desde la mesa y **agente de voz** para pedir hablando |
| **Negocio** | Inventario, fidelización, cupones, campañas, referidos, reportes y auditoría |

Multi-sede y multi-organización desde la base: cada consulta va acotada por
`organization_id` y `branch_id`, y los permisos son granulares por rol
(`packages/config/src/index.ts`).

## Stack

- **Runtime:** [Bun](https://bun.sh) ≥ 1.3
- **Monorepo:** Turborepo + Bun workspaces
- **API:** Hono + Drizzle ORM + tiempo real (WebSocket nativo, Pusher o Ably)
- **Web:** Next.js 16 + TailwindCSS v4 + shadcn/ui
- **DB:** PostgreSQL 18 + Redis 7

## Estructura

```
restai/
├── apps/
│   ├── api/          # API REST + tiempo real (Hono, puerto 3001)
│   ├── web/          # Panel + flujo del comensal (Next.js, puerto 3000)
│   └── landing/      # Web pública
├── packages/
│   ├── db/           # Schema Drizzle, migraciones, seed
│   ├── sunat/        # Facturación electrónica (UBL 2.1, firma, SOAP, CDR)
│   ├── ui/           # Componentes compartidos (shadcn/ui)
│   ├── validators/   # Schemas Zod compartidos
│   ├── types/        # Tipos TypeScript compartidos
│   └── config/       # Roles, permisos y constantes compartidas
├── docs/             # Documentación por área (ver más abajo)
├── docker-compose.yml
└── turbo.json
```

## Puesta en marcha

### 1. Requisitos

- [Bun](https://bun.sh) ≥ 1.3
- [PostgreSQL](https://www.postgresql.org/) 18
- [Redis](https://redis.io/) 7
- [Docker](https://www.docker.com/) si prefieres no instalar Postgres y Redis a mano

### 2. Dependencias

```bash
bun install
```

### 3. Variables de entorno

```bash
cp .env.example .env
```

`.env.example` está escrito para la ruta con Docker, donde `docker-compose`
compone la conexión sola. **Si vas a desarrollar en local con `bun run dev`,
descomenta estas dos**, o `db:migrate` fallará sin explicar por qué:

```env
DATABASE_URL=postgresql://usuario:contraseña@localhost:5432/restai
REDIS_URL=redis://localhost:6379
```

Lo mínimo para arrancar es eso más `JWT_SECRET` y `JWT_REFRESH_SECRET`. Todo lo
demás (SUNAT, agente de voz, correo, imágenes) se activa cuando lo necesites, y
`.env.example` explica cada variable.

Luego copia el `.env` a los paquetes que leen el suyo propio:

```bash
cp .env apps/api/.env
cp .env packages/db/.env
```

Y para el frontend:

```bash
cat > apps/web/.env <<'EOF'
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_APP_URL=http://localhost:3000
EOF
```

> `NEXT_PUBLIC_APP_URL` no es opcional: es la base de los QR de mesa. Sin ella,
> los códigos que generes apuntan a un dominio de producción cableado y el
> comensal que escanee en tu local acaba en otro sitio, sin ningún error visible.

> **Los secretos nunca se versionan.** `.env` está en `.gitignore`; genera tus
> propios `JWT_SECRET` y `JWT_REFRESH_SECRET` y no reutilices los de nadie.

### 4. Base de datos y Redis

**Ruta local** (la de `bun run dev`) — necesitas Postgres y Redis escuchando en
tu máquina. Redis **no es opcional**: sin él cada petición se queda esperando
segundos antes de caer al limitador en memoria, y el sistema entero va a paso de
tortuga sin decir por qué.

```bash
createdb restai
docker run -d --name restai-redis -p 6379:6379 redis:7-alpine
```

**Ruta todo-en-Docker** — `docker-compose.yml` levanta la pila entera (Postgres,
Redis, migraciones, API y web) y compone las conexiones solo. Exige
`POSTGRES_PASSWORD` en el `.env`; si falta, falla al arrancar a propósito en vez
de caer a una contraseña por defecto:

```bash
docker compose up -d
```

> Los servicios del compose **no publican** Postgres ni Redis al host: hablan
> entre ellos por la red interna. Por eso `docker compose up -d redis` no le sirve
> a un `bun run dev` que corre fuera de Docker; para eso usa el `docker run` de
> arriba.

### 5. Crear el esquema

```bash
bun run db:migrate
```

Aplica las migraciones en orden, igual que en producción. Ver la sección de
migraciones para por qué **no** se usa `db:push` aquí.

### 6. Datos de prueba (opcional)

```bash
bun run db:seed
```

Crea una organización de demostración con carta, mesas, personal y pedidos.

### 7. Arrancar

```bash
bun run dev
```

| App | URL |
|---|---|
| Web | http://localhost:3000 |
| API | http://localhost:3001 |

## Migraciones

> [!IMPORTANT]
> **No ejecutes `bun run db:generate`.** Los snapshots de `drizzle-kit` están
> congelados en la migración `0003`, así que generar produciría un SQL que intenta
> recrear desde cero todo lo que existe de la `0004` en adelante. En una base con
> datos, eso los destruye.

De la `0004` en adelante las migraciones se escriben **a mano** en
`packages/db/drizzle/`, y cada una lleva en cabecera por qué existe. El flujo al
añadir una es:

1. Cambiar el schema TypeScript en `packages/db/src/schema/`.
2. Escribir el `.sql` a mano, con `IF NOT EXISTS` donde aplique para que se pueda
   reejecutar sin romper nada.
3. **Registrarla en `packages/db/drizzle/meta/_journal.json`.** Es el paso que se
   olvida: `db:migrate` solo aplica lo que está en el journal, así que una
   migración sin registrar existe en el repositorio, funciona en la máquina de
   quien la escribió —que la aplicó a mano— y no llega jamás a producción. El
   despliegue instala entonces un código cuyo schema TypeScript pide columnas que
   la base no tiene, y todas las consultas de esa tabla revientan.
4. `bun run db:migrate` para aplicarla.

### `db:push` no vale para montar la base

`db:push` sincroniza únicamente el schema **TypeScript**, y las restricciones
escritas a mano no viven ahí: los `CHECK` de stock no negativo (`0004`), las
claves foráneas diferidas (`0005`), el prefijo de RUC (`0013`) o el modo de carta
(`0018`) se quedarían fuera. Produce una base parecida a la de producción pero
no igual — y además no escribe en la tabla de control, así que un `db:migrate`
posterior intenta replicarlo todo desde cero.

Sirve para iterar rápido mientras editas el schema TS. Ten en cuenta que **borra
lo que no esté declarado ahí**: por eso el proyecto no usa disparadores de base
de datos, se perderían en el siguiente push sin que nadie se entere.

## Scripts

| Comando | Qué hace |
|---|---|
| `bun run dev` | API + Web en desarrollo |
| `bun run build` | Build de producción |
| `bun run lint` | Linter en todo el monorepo |
| `bun run test` | Pruebas de todos los paquetes |
| `bun run test:api` | Solo las de la API (necesitan Postgres en marcha) |
| `bun run db:migrate` | Aplica las migraciones pendientes (esto es lo que monta la base) |
| `bun run db:push` | Sincroniza el schema TS a lo bruto; solo para iterar. Ver migraciones |
| `bun run db:seed` | Carga datos de prueba |
| `bun run db:studio` | Drizzle Studio |
| ~~`bun run db:generate`~~ | **No usar.** Ver la sección de migraciones |

Las pruebas de la API corren contra una base real y limpian lo que crean, y
necesitan **Redis en marcha**: sin él cada petición espera al limitador antes de
caer a memoria y la suite pasa de tres segundos a tres minutos, con decenas de
fallos por tiempo agotado que no tienen nada que ver con el código.

## Documentación

| Documento | Contenido |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Capas, servicios y decisiones de fondo |
| [docs/SUNAT.md](docs/SUNAT.md) | Facturación electrónica de punta a punta |
| [docs/VOICE-AGENT.md](docs/VOICE-AGENT.md) | Agente de voz del comensal |
| [docs/REALTIME.md](docs/REALTIME.md) | Tiempo real: WebSocket propio, Pusher o Ably |
| [docs/DEPLOY.md](docs/DEPLOY.md) | Despliegue |
| [docs/manual-operativo.md](docs/manual-operativo.md) | Manual para el personal del local |

## Facturación electrónica (SUNAT)

RestAI declara comprobantes —facturas, boletas, notas de crédito, resúmenes
diarios y comunicaciones de baja— directamente ante SUNAT: genera el XML UBL 2.1,
lo firma, lo comprime y lo envía por SOAP, procesando el CDR.

Se configura el emisor con `PUT /api/sunat/config` y se declara con
`POST /api/invoices/:id/declarar`. Guía completa en [docs/SUNAT.md](docs/SUNAT.md).

## Carta del comensal (QR)

Cada sede elige en su configuración cómo funciona el QR:

- **Carta dinámica** — el comensal escanea, pide acceso, el personal lo acepta y a
  partir de ahí puede pedir desde la mesa (y hablarle al agente de voz).
- **Carta estática** — el comensal escanea y lee la carta, sin pedir acceso ni
  poder pedir. Para locales que quieren la carta digital sin cambiar cómo toman
  la comanda.

Además de los QR por mesa, cada sede tiene una carta pública propia en
`/{sede}/carta/{código}`, que sirve para imprimir en un cartel o compartir por
mensaje sin depender de ninguna mesa.

## Credenciales del seed

`bun run db:seed` crea usuarios de **demostración**, uno por rol, para poder
recorrer el sistema desde cada punto de vista:

| Rol | Email |
|---|---|
| Administrador | `admin@restai.pe` |
| Gerente de sede | `gerente@restai.pe` |
| Cajero | `cajero@restai.pe` |
| Mozo | `mesero@restai.pe` |
| Cocina | `cocina@restai.pe` |

Las contraseñas se imprimen por consola al sembrar.

> [!WARNING]
> Son credenciales de demostración con contraseñas triviales. **Nunca ejecutes el
> seed en producción**, y si alguna vez lo hiciste, borra esos usuarios antes de
> abrir el sistema a nadie.
