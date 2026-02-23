# RestAI

Sistema de gestion de restaurantes multi-tenant.

## Stack

- **Runtime:** [Bun](https://bun.sh)
- **Monorepo:** Turborepo + Bun workspaces
- **API:** Hono + Drizzle ORM + WebSockets (Bun nativo)
- **Web:** Next.js 16 + TailwindCSS v4 + shadcn/ui
- **DB:** PostgreSQL 17 + Redis 7

## Estructura

```
restai/
├── apps/
│   ├── api/          # API REST + WebSocket (Hono, puerto 3001)
│   └── web/          # Dashboard + flujo cliente (Next.js, puerto 3000)
├── packages/
│   ├── db/           # Schema Drizzle, migraciones, seed
│   ├── ui/           # Componentes UI compartidos (shadcn/ui)
│   ├── validators/   # Schemas Zod compartidos
│   ├── types/        # Tipos TypeScript compartidos
│   └── config/       # Configuracion compartida
├── docker-compose.yml
└── turbo.json
```

## Requisitos

- [Bun](https://bun.sh) >= 1.3
- [Docker](https://www.docker.com/) (para Redis)
- [PostgreSQL](https://www.postgresql.org/) 17 (instalado localmente)

## Instalacion

### 1. Clonar el repositorio

```bash
git clone <repo-url>
cd restai
```

### 2. Instalar dependencias

```bash
bun install
```

### 3. Configurar variables de entorno

Copiar el archivo de ejemplo y ajustar los valores:

```bash
cp .env.example .env
```

Editar `.env` con tus credenciales:

```env
# Base de datos PostgreSQL (tu instancia local)
DATABASE_URL=postgresql://usuario:password@localhost:5432/restai

# Redis (via Docker)
REDIS_URL=redis://localhost:6379

# JWT (cambiar en produccion)
JWT_SECRET=tu-secreto-seguro-aqui
JWT_REFRESH_SECRET=otro-secreto-diferente-aqui

# API
API_PORT=3001
API_URL=http://localhost:3001

# Web
NEXT_PUBLIC_API_URL=http://localhost:3001

# Cloudflare R2 (opcional, para imagenes de productos)
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=restai
R2_PUBLIC_URL=
```

Luego copiar los `.env` a cada app/package que lo necesite:

```bash
cp .env apps/api/.env
cp .env packages/db/.env
```

Para el frontend solo se necesita:

```bash
echo "NEXT_PUBLIC_API_URL=http://localhost:3001" > apps/web/.env
```

### 4. Levantar Redis con Docker

```bash
docker compose up -d
```

Esto solo levanta Redis. PostgreSQL debe estar corriendo localmente.

### 5. Crear la base de datos

Si aun no existe la base de datos en tu PostgreSQL local:

```bash
createdb restai
```

### 6. Aplicar schema a la base de datos

```bash
bun run db:push
```

### 7. Cargar datos de prueba (opcional)

```bash
bun run db:seed
```

Esto crea una organizacion demo con categorias, productos, mesas y un usuario admin.

### 8. Iniciar el proyecto

```bash
bun run dev
```

Esto levanta ambas apps simultaneamente con Turborepo:

| App | URL | Descripcion |
|-----|-----|-------------|
| Web | http://localhost:3000 | Dashboard admin + flujo cliente QR |
| API | http://localhost:3001 | API REST + WebSocket |

## Scripts disponibles

| Comando | Descripcion |
|---------|-------------|
| `bun run dev` | Inicia API + Web en modo desarrollo |
| `bun run build` | Build de produccion |
| `bun run db:push` | Aplica schema a la base de datos |
| `bun run db:generate` | Genera migraciones SQL |
| `bun run db:migrate` | Ejecuta migraciones pendientes |
| `bun run db:seed` | Carga datos de prueba |
| `bun run db:studio` | Abre Drizzle Studio (explorador de DB) |

## Credenciales por defecto (seed)

Despues de ejecutar `db:seed`:

- **Email:** `admin@restai.pe`
- **Password:** `admin12345`

## Flujo del cliente (QR)

1. El admin crea mesas en el dashboard con codigos QR
2. El cliente escanea el QR de su mesa
3. Ingresa su nombre y solicita acceso
4. El personal aprueba la conexion desde el dashboard
5. El cliente navega el menu, agrega items al carrito y hace pedidos
6. La cocina ve los pedidos en tiempo real (Kanban)
7. El personal gestiona pagos e imprime tickets
