"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, X, HandHelping, Receipt, UserPlus } from "lucide-react";
import { useWebSocket } from "@/hooks/use-websocket";
import { useAuthStore } from "@/stores/auth-store";
import { useBranchSettings } from "@/hooks/use-settings";
import { useMyAssignedTables } from "@/hooks/use-tables";
import { cn } from "@/lib/utils";
import type { WsMessage } from "@restai/types";

interface Notification {
  id: string;
  type: "call_waiter" | "request_bill" | "session_pending";
  message: string;
  tableNumber: number;
  tableId?: string;
  timestamp: number;
  read: boolean;
}

interface Toast {
  id: string;
  message: string;
  type: Notification["type"];
}

function timeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return "hace un momento";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `hace ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `hace ${hours}h`;
}

const notificationIcon: Record<Notification["type"], typeof Bell> = {
  call_waiter: HandHelping,
  request_bill: Receipt,
  session_pending: UserPlus,
};

const notificationColor: Record<Notification["type"], string> = {
  call_waiter: "text-orange-500",
  request_bill: "text-blue-500",
  session_pending: "text-green-500",
};

export function NotificationBell() {
  const { accessToken, selectedBranchId, user } = useAuthStore();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const panelRef = useRef<HTMLDivElement>(null);

  // Waiter assignment filtering
  const { data: branchSettings } = useBranchSettings();
  const waiterAssignmentEnabled = (branchSettings as any)?.settings?.waiter_table_assignment_enabled ?? false;
  const isWaiter = user?.role === "waiter";
  const shouldFilter = waiterAssignmentEnabled && isWaiter;

  const { data: myAssignedTables } = useMyAssignedTables();
  const assignedTableIds = useRef<Set<string>>(new Set());

  // Keep assignedTableIds in sync
  useEffect(() => {
    if (myAssignedTables && Array.isArray(myAssignedTables)) {
      assignedTableIds.current = new Set(myAssignedTables.map((t: any) => t.table_id));
    }
  }, [myAssignedTables]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const addNotification = useCallback((notif: Omit<Notification, "id" | "read">) => {
    const id = crypto.randomUUID();
    setNotifications((prev) => [{ ...notif, id, read: false }, ...prev].slice(0, 50));

    // Show toast
    const toast: Toast = { id, message: notif.message, type: notif.type };
    setToasts((prev) => [...prev, toast]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  const handleWsMessage = useCallback(
    (msg: WsMessage) => {
      const payload = msg.payload as any;

      // If waiter assignment filtering is active, check if this table is assigned to us
      if (shouldFilter && payload.tableId && !assignedTableIds.current.has(payload.tableId)) {
        return;
      }

      if (msg.type === "table:call_waiter") {
        addNotification({
          type: "call_waiter",
          message: `Mesa ${payload.tableNumber}: ${payload.customerName || "Cliente"} solicita al mozo`,
          tableNumber: payload.tableNumber,
          tableId: payload.tableId,
          timestamp: msg.timestamp,
        });
      } else if (msg.type === "table:request_bill") {
        addNotification({
          type: "request_bill",
          message: `Mesa ${payload.tableNumber}: ${payload.customerName || "Cliente"} solicita la cuenta`,
          tableNumber: payload.tableNumber,
          tableId: payload.tableId,
          timestamp: msg.timestamp,
        });
      } else if (msg.type === "session:pending") {
        addNotification({
          type: "session_pending",
          message: `Mesa ${payload.tableNumber}: Nueva conexion de ${payload.customerName || "cliente"}`,
          tableNumber: payload.tableNumber,
          tableId: payload.tableId,
          timestamp: msg.timestamp,
        });
      }
    },
    [addNotification, shouldFilter],
  );

  useWebSocket(
    selectedBranchId ? [`branch:${selectedBranchId}`] : [],
    handleWsMessage,
    accessToken || undefined,
  );

  const dismissNotification = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  // Close panel on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [open]);

  const handleTogglePanel = useCallback(() => {
    setOpen((prevOpen) => {
      const nextOpen = !prevOpen;
      if (nextOpen) {
        markAllRead();
      }
      return nextOpen;
    });
  }, [markAllRead]);

  return (
    <>
      {/* Toasts */}
      <div className="fixed top-2 right-2 z-[100] flex flex-col gap-2 pointer-events-none">
        {toasts.map((toast) => {
          const Icon = notificationIcon[toast.type];
          return (
            <div
              key={toast.id}
              className="pointer-events-auto flex items-center gap-3 bg-background border shadow-lg rounded-lg px-4 py-3 animate-in slide-in-from-top-2 fade-in duration-300 max-w-sm"
            >
              <Icon className={cn("h-5 w-5 shrink-0", notificationColor[toast.type])} />
              <span className="text-sm">{toast.message}</span>
              <button
                onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
                className="ml-auto p-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Bell + Panel */}
      <div className="relative" ref={panelRef}>
        <button
          onClick={handleTogglePanel}
          className="relative p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] font-medium px-1">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-2 w-80 bg-popover border rounded-lg shadow-lg z-50">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h3 className="text-sm font-semibold">Notificaciones</h3>
              {notifications.length > 0 && (
                <button
                  onClick={clearAll}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Limpiar todo
                </button>
              )}
            </div>

            <div className="max-h-80 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Sin notificaciones
                </div>
              ) : (
                notifications.map((notif) => {
                  const Icon = notificationIcon[notif.type];
                  return (
                    <div
                      key={notif.id}
                      className="flex items-start gap-3 px-4 py-3 border-b last:border-b-0 hover:bg-accent/50 transition-colors"
                    >
                      <Icon
                        className={cn(
                          "h-4 w-4 mt-0.5 shrink-0",
                          notificationColor[notif.type],
                        )}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm leading-snug">{notif.message}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {timeAgo(notif.timestamp)}
                        </p>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          dismissNotification(notif.id);
                        }}
                        className="p-0.5 text-muted-foreground hover:text-foreground shrink-0"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
