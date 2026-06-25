import { db, schema } from "@restai/db";
import { logger } from "./logger.js";

/**
 * Email notifications via Resend, behind a notification_log audit trail.
 *
 * Design:
 * - Provider-agnostic at the call site: callers use sendLoyaltyEmail(...) /
 *   sendTransactionalEmail(...) and never touch the provider. Today the channel
 *   is Resend email; swapping it only touches deliver() below.
 * - Best-effort: this NEVER throws. A failure to notify must never break an
 *   order/loyalty/auth flow, so every path is wrapped and only logged.
 * - Consent-gating depends on the message kind:
 *     · Marketing (sendLoyaltyEmail): gated on customer.marketing_opt_in=true
 *       (Ley 29733). Non-consented sends are logged as 'skipped'.
 *     · Transactional (sendTransactionalEmail): welcome / login code — service
 *       messages the customer requested, sent regardless of marketing consent.
 * - Degrades gracefully: if RESEND_API_KEY is unset (dev), the message is
 *   logged and recorded as 'skipped' instead of sent — no crash.
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const RESEND_FROM = process.env.RESEND_FROM || "RestAI <onboarding@resend.dev>";

export type EmailType =
  | "points_earned"
  | "reward_unlocked"
  | "points_expiring"
  | "birthday"
  | "coupon_assigned"
  | "welcome"
  | "login_code"
  | "campaign";

// Backwards-compatible alias (loyalty.service.ts and others import this name).
export type LoyaltyEmailType = EmailType;

interface SendParams {
  organizationId: string;
  customerId?: string | null;
  toAddress?: string | null;
  marketingOptIn?: boolean;
  type: EmailType;
  /** Template variables; see buildTemplate for the keys each type uses. */
  data?: Record<string, unknown>;
  orgName?: string;
}

function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] || c,
  );
}

// Transactional messages are service emails the customer explicitly asked for
// (account creation, login code) and are never marketing — they bypass consent.
const TRANSACTIONAL_TYPES: ReadonlySet<EmailType> = new Set<EmailType>([
  "welcome",
  "login_code",
]);

const BRAND_COLOR = "#0f172a"; // slate-900 — sober, legible header
const ACCENT_COLOR = "#16a34a"; // emerald-600 — buttons / highlights

/**
 * Email-safe HTML shell. Inline styles + table layout so it renders across
 * Gmail/Outlook/Apple Mail. `transactional` swaps the footer copy (service
 * message vs. marketing-with-unsubscribe).
 */
function shell(opts: {
  brand: string;
  preheader: string;
  heading: string;
  bodyHtml: string;
  transactional: boolean;
}): string {
  const { brand, preheader, heading, bodyHtml, transactional } = opts;
  const footer = transactional
    ? `${esc(brand)} · Este es un mensaje de servicio relacionado con tu cuenta.`
    : `${esc(brand)} · Recibes esto porque aceptaste recibir comunicaciones. Puedes darte de baja cuando quieras.`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="color-scheme" content="light only" />
</head>
<body style="margin:0;padding:0;background:#f1f5f9;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.08);">
          <tr>
            <td style="background:${BRAND_COLOR};padding:20px 28px;">
              <span style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:18px;font-weight:700;color:#ffffff;letter-spacing:0.3px;">${esc(brand)}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0f172a;">
              <h1 style="margin:0 0 16px;font-size:22px;line-height:1.25;color:#0f172a;">${heading}</h1>
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:18px 28px;border-top:1px solid #e2e8f0;">
              <p style="margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:12px;line-height:1.5;color:#94a3b8;">${footer}</p>
            </td>
          </tr>
        </table>
        <p style="margin:16px 0 0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:11px;color:#cbd5e1;">Enviado con RestAI</p>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function paragraph(html: string): string {
  return `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#334155;">${html}</p>`;
}

function codeBox(code: string): string {
  return `<div style="margin:8px 0 18px;text-align:center;">
    <div style="display:inline-block;padding:14px 28px;background:#f1f5f9;border:1px dashed #cbd5e1;border-radius:12px;font-family:'SFMono-Regular',Consolas,Menlo,monospace;font-size:32px;font-weight:700;letter-spacing:8px;color:#0f172a;">${esc(code)}</div>
  </div>`;
}

function buildTemplate(p: SendParams): { subject: string; html: string } {
  const d = p.data ?? {};
  const brand = String(p.orgName || "RestAI");
  const name = esc(d.customerName || "cliente");
  const transactional = TRANSACTIONAL_TYPES.has(p.type);
  const wrap = (heading: string, preheader: string, bodyHtml: string) =>
    shell({ brand, preheader, heading, bodyHtml, transactional });

  switch (p.type) {
    case "welcome": {
      // The welcome coupon is optional and configured by the org admin
      // (org.settings.welcome_coupon_id). When set, it is surfaced prominently.
      const welcomeCoupon = d.couponCode
        ? paragraph(`Para darte la bienvenida${d.couponName ? `, aquí tienes <b>${esc(d.couponName)}</b>` : ", aquí tienes un cupón"}. Úsalo en tu próximo pedido:`) +
          codeBox(String(d.couponCode))
        : "";
      return {
        subject: `¡Bienvenido a ${brand}! 🎉`,
        html: wrap(
          `¡Hola ${name}! Bienvenido 👋`,
          `Tu cuenta de fidelidad en ${brand} ya está lista`,
          paragraph(`Gracias por unirte a <b>${esc(brand)}</b>. Tu cuenta de fidelidad ya está activa: <b>acumulas puntos con cada pedido</b> y podrás canjearlos por recompensas.`) +
          (d.pointsBalance != null
            ? paragraph(`Saldo inicial: <b>${esc(d.pointsBalance)} puntos</b>.`)
            : "") +
          welcomeCoupon +
          paragraph(`Te avisaremos por este medio cuando tengas cupones y recompensas disponibles. ¡Nos vemos pronto!`),
        ),
      };
    }
    case "campaign": {
      // Admin-authored broadcast: data.subject / data.title / data.message are
      // controlled by the campaign. An optional coupon code can be attached.
      const subject = d.subject ? String(d.subject) : `Novedades de ${brand}`;
      const heading = d.title ? esc(String(d.title)) : esc(subject);
      const message = d.message
        ? paragraph(esc(String(d.message)).replace(/\n/g, "<br>"))
        : "";
      return {
        subject,
        html: wrap(
          heading,
          subject,
          paragraph(`Hola ${name},`) +
          message +
          (d.couponCode
            ? paragraph(`Usa este código en tu próximo pedido:`) + codeBox(String(d.couponCode))
            : ""),
        ),
      };
    }
    case "login_code":
      return {
        subject: `Tu código de acceso: ${String(d.code ?? "")}`,
        html: wrap(
          `Tu código de acceso`,
          `Usa este código para iniciar sesión en ${brand}`,
          paragraph(`Hola ${name}, usa este código para iniciar sesión en <b>${esc(brand)}</b>:`) +
          codeBox(String(d.code ?? "")) +
          paragraph(`El código expira en <b>${esc(d.expiresMinutes ?? 10)} minutos</b>. Si no solicitaste iniciar sesión, ignora este correo.`),
        ),
      };
    case "coupon_assigned":
      return {
        subject: `Tienes un nuevo cupón en ${brand} 🏷️`,
        html: wrap(
          `Un cupón para ti 🏷️`,
          `${d.couponName ?? "Tienes un cupón nuevo"} en ${brand}`,
          paragraph(`Hola ${name}, te regalamos <b>${esc(d.couponName)}</b>${d.couponDescription ? ` — ${esc(d.couponDescription)}` : ""}.`) +
          paragraph(`Usa este código en tu próximo pedido:`) +
          codeBox(String(d.couponCode ?? "")) +
          (d.expiresOn ? paragraph(`Válido hasta el <b>${esc(d.expiresOn)}</b>.`) : ""),
        ),
      };
    case "points_earned":
      return {
        subject: `Ganaste ${String(d.points ?? "")} puntos en ${brand}`,
        html: wrap(
          `Sumaste ${esc(d.points)} puntos 🎉`,
          `Tu saldo en ${brand} creció`,
          paragraph(`Hola ${name}, tu saldo ahora es de <b>${esc(d.balance)} puntos</b>. ¡Sigue acumulando para tu próxima recompensa!`),
        ),
      };
    case "reward_unlocked":
      return {
        subject: `Ya puedes canjear "${String(d.rewardName ?? "")}"`,
        html: wrap(
          `Desbloqueaste una recompensa 🎁`,
          `Tienes puntos suficientes para canjear en ${brand}`,
          paragraph(`Hola ${name}, con tus <b>${esc(d.balance)} puntos</b> ya puedes canjear <b>${esc(d.rewardName)}</b> (${esc(d.pointsCost)} pts). Pídela en tu próxima visita.`),
        ),
      };
    case "points_expiring":
      return {
        subject: `Tus ${String(d.points ?? "")} puntos están por expirar`,
        html: wrap(
          `No pierdas tus puntos ⏳`,
          `Tus puntos en ${brand} están por vencer`,
          paragraph(`Hola ${name}, <b>${esc(d.points)} puntos</b> expiran el <b>${esc(d.expiresOn)}</b>. Visítanos antes para usarlos.`),
        ),
      };
    case "birthday":
      return {
        subject: `¡Feliz cumpleaños! Un regalo de ${brand} 🎂`,
        html: wrap(
          `¡Feliz cumpleaños! 🎂`,
          `${brand} te tiene una sorpresa`,
          paragraph(`Hola ${name}, para celebrar te dejamos <b>${esc(d.rewardDescription || "un beneficio especial")}</b>. ${d.couponCode ? `Usa el código <b>${esc(d.couponCode)}</b>.` : ""}`),
        ),
      };
    default:
      return { subject: brand, html: wrap(esc(brand), esc(brand), "") };
  }
}

async function deliver(to: string, subject: string, html: string): Promise<void> {
  if (!RESEND_API_KEY) {
    const err = new Error("RESEND_API_KEY not configured");
    (err as any).skip = true;
    throw err;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: RESEND_FROM, to: [to], subject, html }),
    // Bound the call so a slow/hung Resend never stalls the awaiting request
    // (register/login/coupon-assign). On timeout this throws and is recorded
    // as 'failed' by persistAndDeliver — best-effort, never blocking.
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${body.slice(0, 200)}`);
  }
}

/**
 * Single delivery + audit path shared by both consent-gated and transactional
 * sends. Never throws. `gateOnConsent` toggles the Ley 29733 marketing gate.
 */
async function persistAndDeliver(params: {
  organizationId: string;
  customerId?: string | null;
  to: string;
  type: EmailType;
  subject: string;
  html: string;
  gateOnConsent: boolean;
  marketingOptIn?: boolean;
}): Promise<void> {
  const to = (params.to || "").trim();
  let status: "sent" | "failed" | "skipped" = "skipped";
  let error: string | null = null;

  try {
    if (params.gateOnConsent && !params.marketingOptIn) {
      error = "no marketing consent";
    } else if (!to) {
      error = "no email address";
    } else {
      try {
        await deliver(to, params.subject, params.html);
        status = "sent";
      } catch (e: any) {
        if (e?.skip) {
          error = "provider not configured (logged only)";
          logger.info("Notification skipped (no provider)", { type: params.type, to });
        } else {
          status = "failed";
          error = e?.message || "send failed";
          logger.warn("Notification send failed", { type: params.type, error });
        }
      }
    }

    await db.insert(schema.notificationLog).values({
      organization_id: params.organizationId,
      customer_id: params.customerId ?? null,
      type: params.type,
      channel: "email",
      to_address: to || null,
      subject: params.subject,
      status,
      error,
      sent_at: status === "sent" ? new Date() : null,
    });
  } catch (e: any) {
    // Logging/DB failure must never bubble into the caller's flow.
    logger.error("notification persist/deliver failed entirely", { type: params.type, error: e?.message });
  }
}

/**
 * Consent-gated, logged, best-effort marketing email. Never throws.
 * Callers pass the customer's email + marketing_opt_in (fetch them alongside
 * the loyalty data you already load).
 */
export async function sendLoyaltyEmail(p: SendParams): Promise<void> {
  const tpl = buildTemplate(p);
  await persistAndDeliver({
    organizationId: p.organizationId,
    customerId: p.customerId,
    to: (p.toAddress || "").trim(),
    type: p.type,
    subject: tpl.subject,
    html: tpl.html,
    gateOnConsent: true,
    marketingOptIn: p.marketingOptIn,
  });
}

/**
 * Transactional, logged, best-effort email (welcome, login code). NOT gated on
 * marketing consent — these are service messages the customer requested. Never
 * throws.
 */
export async function sendTransactionalEmail(p: SendParams): Promise<void> {
  const tpl = buildTemplate(p);
  await persistAndDeliver({
    organizationId: p.organizationId,
    customerId: p.customerId,
    to: (p.toAddress || "").trim(),
    type: p.type,
    subject: tpl.subject,
    html: tpl.html,
    gateOnConsent: false,
  });
}
