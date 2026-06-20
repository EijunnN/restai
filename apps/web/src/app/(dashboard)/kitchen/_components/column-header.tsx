"use client";

import { cn } from "@/lib/utils";

export function ColumnHeader({
  icon: Icon,
  label,
  count,
  variant,
  pulse,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  count: number;
  variant: "pending" | "preparing" | "ready";
  pulse?: boolean;
}) {
  const styles = {
    pending: "bg-amber-500/15 border-amber-500/30 text-amber-800 dark:text-amber-300",
    preparing: "bg-blue-500/15 border-blue-500/30 text-blue-800 dark:text-blue-300",
    ready: "bg-green-500/15 border-green-500/30 text-green-800 dark:text-green-300",
  };

  const countBg = {
    pending: "bg-amber-500 text-white",
    preparing: "bg-blue-500 text-white",
    ready: "bg-green-500 text-white",
  };

  return (
    <div
      className={cn(
        "sticky top-0 z-10 flex items-center justify-between rounded-2xl border px-4 py-3 backdrop-blur-sm shadow-sm",
        styles[variant],
        pulse && "animate-pulse"
      )}
    >
      <div className="flex items-center gap-2">
        <div className="rounded-xl bg-background/70 p-2">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] opacity-70">
            Estado
          </p>
          <h2 className="font-black text-sm uppercase tracking-wide">{label}</h2>
        </div>
      </div>
      <span
        className={cn(
          "flex items-center justify-center h-9 min-w-9 rounded-xl px-2 text-sm font-black",
          countBg[variant]
        )}
      >
        {count}
      </span>
    </div>
  );
}
