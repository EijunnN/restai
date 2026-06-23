import { db, schema } from "@restai/db";
import { logger } from "./logger.js";

/**
 * Email notifications via Resend, behind a notification_log audit trail.
 *
 * Design:
 * - Provider-agnostic at the call site: callers use sendLoyaltyEmail(...) and
 *   never touch the provider. Today the channel is Resend email; swapping it
 *   only touches deliver() below.
 * - Best-effort: this NEVER throws. A failure to notify must never break an
 *   order/loyalty flow, so every path is wrapped and only logged.
 * - Consent-gated (Ley 29733): nothing is sent unless the customer has
 *   marketing_opt_in=true. Non-consented sends are logged as 'skipped'.
 * - Degrades gracefully: if RESEND_API_KEY is unset (dev), the message is
 *   logged and recorded as 'skipped' instead of sent — no crash.
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const RESEND_FROM = process.env.RESEND_FROM || "RestAI <onboarding@resend.dev>";

export type LoyaltyEmailType =
  | "points_earned"
  | "reward_unlocked"
  | "points_expiring"
  | "birthday"
  | "coupon_assigned";

interface SendParams {
  organizationId: string;
  customerId?: string | null;
  toAddress?: string | null;
  marketingOptIn?: boolean;
  type: LoyaltyEmailType;
  /** Template variables; see buildTemplate for the keys each type uses. */
  data?: Record<string, unknown>;
  orgName?: string;
}

function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] || c,
  );
}

function buildTemplate(p: SendParams): { subject: string; html: string } {
  const d = p.data ?? {};
  const brand = esc(p.orgName || "RestAI");
  const name = esc(d.customerName || "cliente");
  const wrap = (title: string, body: string) =>
    `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#111">
      <h2 style="margin:0 0 12px">${title}</h2>
      <p style="margin:0 0 8px">Hola ${name},</p>
      ${body}
      <p style="margin-top:24px;font-size:12px;color:#888">${brand} · Recibes esto porque aceptaste recibir comunicaciones. Puedes darte de baja cuando quieras.</p>
    </div>`;

  switch (p.type) {
    case "points_earned":
      return {
        subject: `Ganaste ${esc(d.points)} puntos en ${brand}`,
        html: wrap(
          `Sumaste ${esc(d.points)} puntos 🎉`,
          `<p>Tu saldo ahora es de <b>${esc(d.balance)} puntos</b>. ¡Sigue acumulando para tu próxima recompensa!</p>`,
        ),
      };
    case "reward_unlocked":
      return {
        subject: `Ya puedes canjear "${esc(d.rewardName)}"`,
        html: wrap(
          `Desbloqueaste una recompensa 🎁`,
          `<p>Con tus <b>${esc(d.balance)} puntos</b> ya puedes canjear <b>${esc(d.rewardName)}</b> (${esc(d.pointsCost)} pts). Pídela en tu próxima visita.</p>`,
        ),
      };
    case "points_expiring":
      return {
        subject: `Tus ${esc(d.points)} puntos están por expirar`,
        html: wrap(
          `No pierdas tus puntos ⏳`,
          `<p><b>${esc(d.points)} puntos</b> expiran el <b>${esc(d.expiresOn)}</b>. Visítanos antes para usarlos.</p>`,
        ),
      };
    case "birthday":
      return {
        subject: `¡Feliz cumpleaños! Un regalo de ${brand} 🎂`,
        html: wrap(
          `¡Feliz cumpleaños! 🎂`,
          `<p>Para celebrar, te dejamos <b>${esc(d.rewardDescription || "un beneficio especial")}</b>. ${esc(d.couponCode ? `Usa el código <b>${esc(d.couponCode)}</b>.` : "")}</p>`,
        ),
      };
    case "coupon_assigned":
      return {
        subject: `Tienes un nuevo cupón en ${brand}`,
        html: wrap(
          `Un cupón para ti 🏷️`,
          `<p><b>${esc(d.couponName)}</b> — usa el código <b>${esc(d.couponCode)}</b> en tu próximo pedido.</p>`,
        ),
      };
    default:
      return { subject: `${brand}`, html: wrap(brand, "") };
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
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${body.slice(0, 200)}`);
  }
}

/**
 * Consent-gated, logged, best-effort loyalty email. Never throws.
 * Callers pass the customer's email + marketing_opt_in (fetch them alongside
 * the loyalty data you already load).
 */
export async function sendLoyaltyEmail(p: SendParams): Promise<void> {
  const to = (p.toAddress || "").trim();
  let status: "sent" | "failed" | "skipped" = "skipped";
  let error: string | null = null;
  let subject = "";

  try {
    const tpl = buildTemplate(p);
    subject = tpl.subject;

    if (!p.marketingOptIn) {
      error = "no marketing consent";
    } else if (!to) {
      error = "no email address";
    } else {
      try {
        await deliver(to, tpl.subject, tpl.html);
        status = "sent";
      } catch (e: any) {
        if (e?.skip) {
          error = "provider not configured (logged only)";
          logger.info("Notification skipped (no provider)", { type: p.type, to });
        } else {
          status = "failed";
          error = e?.message || "send failed";
          logger.warn("Notification send failed", { type: p.type, error });
        }
      }
    }

    await db.insert(schema.notificationLog).values({
      organization_id: p.organizationId,
      customer_id: p.customerId ?? null,
      type: p.type,
      channel: "email",
      to_address: to || null,
      subject,
      status,
      error,
      sent_at: status === "sent" ? new Date() : null,
    });
  } catch (e: any) {
    // Logging/DB failure must never bubble into the caller's flow.
    logger.error("sendLoyaltyEmail failed entirely", { type: p.type, error: e?.message });
  }
}
