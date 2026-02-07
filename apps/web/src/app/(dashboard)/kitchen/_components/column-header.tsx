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
    pending: "bg-amber-500/15 border-amber-500/30 text-amber-700 dark:text-amber-400",
    preparing: "bg-blue-500/15 border-blue-500/30 text-blue-700 dark:text-blue-400",
    ready: "bg-green-500/15 border-green-500/30 text-green-700 dark:text-green-400",
  };

  const countBg = {
    pending: "bg-amber-500 text-white",
    preparing: "bg-blue-500 text-white",
    ready: "bg-green-500 text-white",
  };

  return (
    <div
      className={cn(
        "flex items-center justify-between p-3 rounded-lg border sticky top-0 z-10 backdrop-blur-sm",
        styles[variant],
        pulse && "animate-pulse"
      )}
    >
      <div className="flex items-center gap-2">
        <Icon className="h-5 w-5" />
        <h2 className="font-bold text-sm uppercase tracking-wide">{label}</h2>
      </div>
      <span
        className={cn(
          "flex items-center justify-center h-7 min-w-7 px-1.5 rounded-full text-sm font-bold",
          countBg[variant]
        )}
      >
        {count}
      </span>
    </div>
  );
}
