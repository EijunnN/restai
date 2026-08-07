import { Hono } from "hono";
import type { AppEnv } from "./types.js";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { logger } from "hono/logger";

// Import middleware
import { errorHandler } from "./middleware/error-handler.js";
import { rateLimiter } from "./middleware/rate-limit.js";

// Import routes
import { health } from "./routes/health.js";
import { auth } from "./routes/auth.js";
import { orgs } from "./routes/orgs.js";
import { branches } from "./routes/branches.js";
import { menu } from "./routes/menu.js";
import { tables } from "./routes/tables.js";
import { spaces } from "./routes/spaces.js";
import { orders } from "./routes/orders.js";
import { kitchen } from "./routes/kitchen.js";
import { payments } from "./routes/payments.js";
import { invoices } from "./routes/invoices.js";
import { sunat } from "./routes/sunat.js";
import { realtime } from "./routes/realtime.js";
import { inventory } from "./routes/inventory.js";
import { loyalty } from "./routes/loyalty.js";
import { staff } from "./routes/staff.js";
import { reports } from "./routes/reports.js";
import { settings } from "./routes/settings.js";
import { customer } from "./routes/customer.js";
import { uploads } from "./routes/uploads.js";
import { coupons } from "./routes/coupons.js";
import { campaigns } from "./routes/campaigns.js";
import { referrals } from "./routes/referrals.js";
import { cash } from "./routes/cash.js";
import { serviceRequests } from "./routes/service-requests.js";
import { voice } from "./routes/voice.js";
// `audit` es también el nombre del helper de escritura (lib/audit.ts); se
// renombra al importar la RUTA para que no se confundan al leer el montaje.
import { audit as auditRoute } from "./routes/audit.js";

const CORS_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",")
  : ["http://localhost:3000"];

const app = new Hono<AppEnv>();

// Global middleware
app.use(
  "*",
  cors({
    origin: (origin) => {
      // Reflect the origin only when it is explicitly allow-listed. For unknown
      // or absent origins return a falsy value so no Access-Control-Allow-Origin
      // header is emitted — never reflect a credentialed ACAO for a non-allowed
      // origin.
      if (origin && CORS_ORIGINS.includes(origin)) return origin;
      return null;
    },
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization", "X-Requested-With", "X-Branch-Id"],
    allowMethods: ["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH", "OPTIONS"],
    maxAge: 86400,
  })
);
app.use("*", secureHeaders());
app.use("*", logger());
app.onError(errorHandler);
// Topes de peticiones.
//
// Estos números son los ANÓNIMOS, que se cuentan POR IP — y un restaurante
// entero (personal y comensales) sale por una sola IP pública. Los de antes
// (100 global / 30 comensal) se agotaban solos: la pantalla de espera del
// comensal sondea su estado cada 5 s SIN token, así que tres personas
// esperando aprobación consumían el cubo de comensal y ocho el global. En hora
// punta, que es cuando no puede fallar, el local se bloqueaba a sí mismo.
//
// Las peticiones AUTENTICADAS no usan la IP: el middleware las cuenta por
// identidad (usuario o sesión de comensal), con un tope mayor. Ver
// `rateLimiter` y las variables RATE_LIMIT_<PREFIJO>_ANON_MAX /
// RATE_LIMIT_<PREFIJO>_USER_MAX / RATE_LIMIT_USER_FACTOR para ajustarlo sin
// tocar código.
//
// `auth` se queda deliberadamente bajo: ahí sí importa frenar la fuerza bruta
// contra el login, y su volumen legítimo es mínimo.
app.use("*", rateLimiter(200, 60_000, "global"));
app.use("/api/auth/*", rateLimiter(20, 60_000, "auth"));
app.use("/api/customer/*", rateLimiter(150, 60_000, "customer"));

// Root: índice informativo de la API (evita el 404 "pelado" en /).
app.get("/", (c) =>
  c.json({
    name: "RestAI API",
    status: "ok",
    docs: "https://github.com/darwinva97/restai/tree/main/docs",
    endpoints: ["/health", "/api/auth", "/api/orders", "/api/invoices", "/api/sunat", "/api/realtime"],
  }),
);

// Public routes
app.route("/health", health);
app.route("/api/auth", auth);
app.route("/api/customer", customer);
// El mesero por voz: `/config` es público (dice si la función existe) y
// `/session` exige token de comensal con sesión de mesa activa.
app.route("/api/voice", voice);

// Protected routes (auth middleware applied within each route module)
app.route("/api/orgs", orgs);
app.route("/api/branches", branches);
app.route("/api/menu", menu);
app.route("/api/tables", tables);
app.route("/api/spaces", spaces);
app.route("/api/orders", orders);
app.route("/api/kitchen", kitchen);
app.route("/api/payments", payments);
app.route("/api/invoices", invoices);
app.route("/api/sunat", sunat);
app.route("/api/realtime", realtime);
app.route("/api/inventory", inventory);
app.route("/api/loyalty", loyalty);
app.route("/api/staff", staff);
app.route("/api/reports", reports);
app.route("/api/settings", settings);
app.route("/api/uploads", uploads);
app.route("/api/coupons", coupons);
app.route("/api/campaigns", campaigns);
app.route("/api/referrals", referrals);
app.route("/api/cash", cash);
app.route("/api/service-requests", serviceRequests);
app.route("/api/audit", auditRoute);

// 404 en JSON consistente con el resto de la API.
app.notFound((c) =>
  c.json(
    { success: false, error: { code: "NOT_FOUND", message: `Ruta no encontrada: ${c.req.method} ${new URL(c.req.url).pathname}` } },
    404,
  ),
);

export type AppType = typeof app;
export { app };
