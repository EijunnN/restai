import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { organizations } from "./tenants";

// Audit log of every notification the system attempted to deliver. Keeps an
// immutable trail (status/error) independent of the delivery provider, so the
// channel (Resend email today, others later) is pluggable behind it.
export const notificationLog = pgTable(
  "notification_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organization_id: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    customer_id: uuid("customer_id"), // FK to customers via migration (set null)
    type: text("type").notNull(), // points_earned | reward_unlocked | points_expiring | birthday | coupon_assigned
    channel: text("channel").default("email").notNull(),
    to_address: text("to_address"),
    subject: text("subject"),
    status: text("status").default("queued").notNull(), // queued | sent | failed | skipped
    error: text("error"),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    sent_at: timestamp("sent_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_notification_log_org").on(t.organization_id),
    index("idx_notification_log_customer").on(t.customer_id),
  ],
);
