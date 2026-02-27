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
import { inventory } from "./routes/inventory.js";
import { loyalty } from "./routes/loyalty.js";
import { staff } from "./routes/staff.js";
import { reports } from "./routes/reports.js";
import { settings } from "./routes/settings.js";
import { customer } from "./routes/customer.js";
import { uploads } from "./routes/uploads.js";
import { coupons } from "./routes/coupons.js";

const CORS_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(",")
  : ["http://localhost:3000"];

const app = new Hono<AppEnv>();

// Global middleware
app.use(
  "*",
  cors({
    origin: (origin) => {
      if (CORS_ORIGINS.includes(origin)) return origin;
      return CORS_ORIGINS[0];
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
app.use("*", rateLimiter(100, 60_000, "global"));
app.use("/api/auth/*", rateLimiter(20, 60_000, "auth"));
app.use("/api/customer/*", rateLimiter(30, 60_000, "customer"));

// Public routes
app.route("/health", health);
app.route("/api/auth", auth);
app.route("/api/customer", customer);

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
app.route("/api/inventory", inventory);
app.route("/api/loyalty", loyalty);
app.route("/api/staff", staff);
app.route("/api/reports", reports);
app.route("/api/settings", settings);
app.route("/api/uploads", uploads);
app.route("/api/coupons", coupons);

export type AppType = typeof app;
export { app };
