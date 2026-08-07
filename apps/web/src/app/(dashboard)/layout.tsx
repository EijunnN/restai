"use client";

import { useAuthStore } from "@/stores/auth-store";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  LayoutDashboard,
  UtensilsCrossed,
  ClipboardList,
  Grid3X3,
  ChefHat,
  Package,
  Wifi,
  Heart,
  Users,
  CreditCard,
  BarChart3,
  Settings,
  LogOut,
  Menu,
  X,
  ChevronLeft,
  Building2,
  ChevronDown,
  Store,
  Smartphone,
  Megaphone,
  Share2,
  Wallet,
  Receipt,
  ScrollText,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@restai/ui/components/button";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@restai/ui/components/select";
import { cn } from "@/lib/utils";
import { canAccessRoute, landingRouteForRole, roleLabel } from "@/lib/permissions";
import { useOrgSettings, useBranches } from "@/hooks/use-settings";
import { NotificationBell } from "@/components/notification-bell";

interface NavGroup {
  label: string;
  items: { href: string; label: string; icon: React.ElementType }[];
}

interface Branch {
  id: string;
  name: string;
  slug: string;
  address: string | null;
}

const navGroups: NavGroup[] = [
  {
    label: "General",
    items: [
      { href: "/", label: "Panel", icon: LayoutDashboard },
    ],
  },
  {
    label: "Operaciones",
    items: [
      { href: "/pos", label: "POS", icon: Smartphone },
      { href: "/orders", label: "Órdenes", icon: ClipboardList },
      { href: "/tables", label: "Mesas", icon: Grid3X3 },
      { href: "/kitchen", label: "Cocina", icon: ChefHat },
      { href: "/connections", label: "Conexiones", icon: Wifi },
      { href: "/menu", label: "Menú", icon: UtensilsCrossed },
    ],
  },
  {
    label: "Caja",
    items: [
      { href: "/payments", label: "Pagos", icon: CreditCard },
      { href: "/caja", label: "Arqueo", icon: Wallet },
      { href: "/invoices", label: "Comprobantes", icon: Receipt },
    ],
  },
  {
    label: "Gestión",
    items: [
      { href: "/inventory", label: "Inventario", icon: Package },
      { href: "/staff", label: "Personal", icon: Users },
    ],
  },
  {
    label: "Negocio",
    items: [
      { href: "/loyalty", label: "Fidelización", icon: Heart },
      { href: "/campaigns", label: "Campañas", icon: Megaphone },
      { href: "/referrals", label: "Referidos", icon: Share2 },
      { href: "/reports", label: "Reportes", icon: BarChart3 },
      { href: "/audit", label: "Auditoría", icon: ScrollText },
      { href: "/settings", label: "Configuración", icon: Settings },
    ],
  },
];

/**
 * La navegación se deriva de la MISMA matriz de permisos que aplica la API.
 * Antes había una lista paralela por rol que se desincronizó: el cocinero
 * aterrizaba en "/" (que exige reports:read, permiso que no tiene) y recibía dos
 * bandas rojas de error nada más fichar.
 *
 * Un rol desconocido ahora no ve NADA, en vez de heredar el menú completo de
 * administrador como ocurría con el antiguo `|| roleNavAccess.org_admin`.
 */
function getFilteredNavGroups(role: string | undefined): NavGroup[] {
  return navGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => canAccessRoute(role, item.href)),
    }))
    .filter((group) => group.items.length > 0);
}

function isActive(pathname: string, href: string) {
  return pathname === href || (href !== "/" && pathname.startsWith(href));
}

function BrandMark({ logoUrl }: { logoUrl?: string | null }) {
  if (logoUrl) {
    return (
      <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white">
        <img src={logoUrl} alt="Logo" className="h-full w-full object-contain p-0.5" />
      </div>
    );
  }
  return (
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
      <Store className="h-4 w-4" />
    </div>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, isAuthenticated, logout, selectedBranchId, setSelectedBranch } =
    useAuthStore();
  const router = useRouter();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const queryClient = useQueryClient();

  const { data: org } = useOrgSettings();
  const { data: branches } = useBranches();
  const availableBranches = branches ?? [];
  const canSwitchBranch = availableBranches.length > 1;

  const currentBranch = availableBranches.find((branch: Branch) => branch.id === selectedBranchId);

  const handleBranchChange = useCallback(
    (branchId: string) => {
      if (branchId === selectedBranchId) return;
      setSelectedBranch(branchId);
      queryClient.invalidateQueries();
    },
    [selectedBranchId, setSelectedBranch, queryClient],
  );

  useEffect(() => {
    if (!isAuthenticated()) {
      router.push("/login");
    }
  }, [isAuthenticated, router]);

  // Guard de ruta real. Ocultar el enlace en el menú no impedía escribir la URL:
  // /settings estaba oculto para el gerente pero seguía siendo accesible, y sus
  // GET tampoco exigían permiso, así que podía bajar el IGV del 18 % al 0 %.
  // Rutas anidadas (p. ej. /loyalty/<id>) heredan el permiso de su raíz.
  const routeRoot = pathname === "/" ? "/" : `/${pathname.split("/")[1] ?? ""}`;
  const routeAllowed = user ? canAccessRoute(user.role, routeRoot) : true;

  useEffect(() => {
    if (user && !routeAllowed) {
      router.replace(landingRouteForRole(user.role));
    }
  }, [user, routeAllowed, router]);

  useEffect(() => {
    if (availableBranches.length === 0) return;

    const selectedBranchStillAllowed = selectedBranchId
      ? availableBranches.some((branch: Branch) => branch.id === selectedBranchId)
      : false;

    if (!selectedBranchStillAllowed) {
      setSelectedBranch(availableBranches[0].id);
      queryClient.invalidateQueries();
    }
  }, [availableBranches, selectedBranchId, setSelectedBranch, queryClient]);

  // Sin usuario en memoria: o se está restaurando la sesión, o el refresh token
  // caducó de noche. Antes esto era un "Cargando..." eterno y la tablet de la
  // cocina amanecía inservible; ahora se ofrece siempre una salida.
  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="animate-pulse text-muted-foreground">Cargando tu sesión...</div>
        <p className="text-sm text-muted-foreground max-w-xs">
          Si esta pantalla no avanza, tu sesión pudo haber caducado.
        </p>
        <Button variant="outline" size="sm" onClick={() => router.push("/login")}>
          Iniciar sesión de nuevo
        </Button>
      </div>
    );
  }

  const handleLogout = () => {
    logout();
    router.push("/login");
  };

  const orgName = org?.name || "RestAI";

  const filteredNavGroups = getFilteredNavGroups(user.role);
  const allFilteredItems = filteredNavGroups.flatMap((g) => g.items);

  // Barra inferior del móvil: los 5 destinos que ese rol usa de verdad, no los 5
  // primeros del menú. Con el antiguo slice(0,5) ciego, "Conexiones" —donde el
  // mesero aprueba a cada comensal que escanea— caía fuera y costaba dos toques
  // extra cada vez, todo el turno.
  const MOBILE_PRIORITY: Record<string, string[]> = {
    waiter: ["/tables", "/connections", "/orders", "/pos", "/kitchen"],
    cashier: ["/pos", "/orders", "/payments", "/caja", "/invoices"],
    kitchen: ["/kitchen"],
    branch_manager: ["/", "/tables", "/orders", "/kitchen", "/reports"],
    org_admin: ["/", "/tables", "/orders", "/reports", "/settings"],
  };
  const priority = MOBILE_PRIORITY[user.role ?? ""] ?? [];
  const prioritized = priority
    .map((href) => allFilteredItems.find((i) => i.href === href))
    .filter((i): i is NavGroup["items"][number] => Boolean(i));
  const mobileNavItems = [
    ...prioritized,
    ...allFilteredItems.filter((i) => !prioritized.some((p) => p.href === i.href)),
  ].slice(0, 5);

  return (
    <div className="h-screen flex overflow-hidden">
      {/* Desktop Sidebar */}
      <aside
        className={cn(
          "hidden md:flex flex-col border-r bg-sidebar transition-all duration-300 relative",
          collapsed ? "w-[68px]" : "w-64"
        )}
      >
        {/* Brand header */}
        <div className="h-14 flex items-center gap-3 px-4 border-b border-sidebar-border">
          <BrandMark logoUrl={org?.logo_url} />
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-sidebar-foreground truncate leading-tight">
                {orgName}
              </p>
              <p className="text-[11px] text-muted-foreground truncate leading-tight">
                Gestión del restaurante
              </p>
            </div>
          )}
        </div>

        {/* Branch selector */}
        {!collapsed && canSwitchBranch && (
          <div className="px-3 py-2 border-b border-sidebar-border">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1 block">
              Sede activa
            </label>
            <Select value={selectedBranchId || undefined} onValueChange={handleBranchChange}>
              <SelectTrigger className="h-auto text-xs bg-sidebar-accent/50 text-sidebar-foreground border-sidebar-border py-1.5 focus:ring-sidebar-ring">
                <SelectValue placeholder="Seleccionar sede" />
              </SelectTrigger>
              <SelectContent>
                {availableBranches.map((branch: Branch) => (
                  <SelectItem key={branch.id} value={branch.id}>
                    {branch.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Branch name display (single branch or collapsed) */}
        {!collapsed && availableBranches.length === 1 && currentBranch && (
          <div className="px-3 py-2 border-b border-sidebar-border">
            <div className="flex items-center gap-2">
              <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-xs text-muted-foreground truncate">
                {currentBranch.name}
              </span>
            </div>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-2 px-2">
          {filteredNavGroups.map((group) => (
            <div key={group.label} className="mb-1">
              {!collapsed && (
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-3 pt-3 pb-1">
                  {group.label}
                </p>
              )}
              {collapsed && group.label !== "General" && (
                <div className="mx-2 my-2 border-t border-sidebar-border" />
              )}
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const active = isActive(pathname, item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      title={collapsed ? item.label : undefined}
                      className={cn(
                        "flex items-center gap-3 rounded-md text-[13px] transition-colors relative",
                        collapsed
                          ? "justify-center px-0 py-2.5 mx-auto w-10"
                          : "px-3 py-2",
                        active
                          ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                      )}
                    >
                      {active && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 bg-sidebar-primary rounded-r-full" />
                      )}
                      <item.icon className={cn("shrink-0", collapsed ? "h-5 w-5" : "h-4 w-4")} />
                      {!collapsed && <span>{item.label}</span>}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3 top-20 z-10 flex h-6 w-6 items-center justify-center rounded-full border bg-background shadow-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft
            className={cn(
              "h-3 w-3 transition-transform",
              collapsed && "rotate-180"
            )}
          />
        </button>

        {/* User footer */}
        <div className="border-t border-sidebar-border p-2">
          {!collapsed ? (
            <div className="flex items-center gap-3 rounded-md px-2 py-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-sidebar-accent-foreground text-xs font-medium uppercase">
                {user.name?.charAt(0) || "?"}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-sidebar-foreground truncate leading-tight">
                  {user.name}
                </p>
                <p className="text-[11px] text-muted-foreground truncate leading-tight">
                  {roleLabel(user.role)}
                </p>
              </div>
              <button
                onClick={handleLogout}
                title="Cerrar sesión"
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-1">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sidebar-accent text-sidebar-accent-foreground text-xs font-medium uppercase">
                {user.name?.charAt(0) || "?"}
              </div>
              <button
                onClick={handleLogout}
                title="Cerrar sesión"
                className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="flex items-center justify-between h-14 px-4">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden"
                onClick={() => setMobileOpen(!mobileOpen)}
              >
                {mobileOpen ? (
                  <X className="h-5 w-5" />
                ) : (
                  <Menu className="h-5 w-5" />
                )}
              </Button>
              <span className="font-semibold md:hidden">{orgName}</span>
            </div>

            <div className="flex items-center gap-3">
              {/* Mobile branch selector */}
              {canSwitchBranch && (
                <div className="md:hidden">
                  <Select value={selectedBranchId || undefined} onValueChange={handleBranchChange}>
                    <SelectTrigger className="h-auto text-xs py-1.5 w-auto min-w-[8rem]">
                      <SelectValue placeholder="Sede" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableBranches.map((branch: Branch) => (
                        <SelectItem key={branch.id} value={branch.id}>
                          {branch.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {/* Current branch badge on desktop */}
              {currentBranch && (
                <div className="hidden md:flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Building2 className="h-3.5 w-3.5" />
                  <span>{currentBranch.name}</span>
                </div>
              )}
              <NotificationBell />
              <div className="hidden md:flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {user.name}
                </span>
              </div>
            </div>
          </div>
        </header>

        {/* Mobile sidebar overlay */}
        {mobileOpen && (
          <div className="md:hidden fixed inset-0 z-50">
            <div
              className="absolute inset-0 bg-black/40 backdrop-blur-sm"
              onClick={() => setMobileOpen(false)}
            />
            <div className="fixed inset-y-0 left-0 w-72 bg-sidebar border-r shadow-xl flex flex-col">
              {/* Mobile header */}
              <div className="h-14 flex items-center justify-between px-4 border-b border-sidebar-border">
                <div className="flex items-center gap-3">
                  <BrandMark logoUrl={org?.logo_url} />
                  <span className="font-semibold text-sm text-sidebar-foreground">
                    {orgName}
                  </span>
                </div>
                <button
                  onClick={() => setMobileOpen(false)}
                  className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Mobile branch selector */}
              {canSwitchBranch && (
                <div className="px-3 py-2 border-b border-sidebar-border">
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1 block">
                    Sede activa
                  </label>
                  <Select value={selectedBranchId || undefined} onValueChange={handleBranchChange}>
                    <SelectTrigger className="h-auto text-xs bg-sidebar-accent/50 text-sidebar-foreground border-sidebar-border py-1.5 focus:ring-sidebar-ring">
                      <SelectValue placeholder="Seleccionar sede" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableBranches.map((branch: Branch) => (
                        <SelectItem key={branch.id} value={branch.id}>
                          {branch.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {currentBranch && availableBranches.length <= 1 && (
                <div className="px-3 py-2 border-b border-sidebar-border">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-xs text-muted-foreground truncate">
                      {currentBranch.name}
                    </span>
                  </div>
                </div>
              )}

              {/* Mobile nav */}
              <nav className="flex-1 overflow-y-auto py-2 px-2">
                {filteredNavGroups.map((group) => (
                  <div key={group.label} className="mb-1">
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-3 pt-3 pb-1">
                      {group.label}
                    </p>
                    <div className="space-y-0.5">
                      {group.items.map((item) => {
                        const active = isActive(pathname, item.href);
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            onClick={() => setMobileOpen(false)}
                            className={cn(
                              "flex items-center gap-3 px-3 py-2 rounded-md text-[13px] transition-colors relative",
                              active
                                ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                                : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                            )}
                          >
                            {active && (
                              <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 bg-sidebar-primary rounded-r-full" />
                            )}
                            <item.icon className="h-4 w-4 shrink-0" />
                            <span>{item.label}</span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </nav>

              {/* Mobile user footer */}
              <div className="border-t border-sidebar-border p-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-sidebar-accent-foreground text-xs font-medium uppercase">
                    {user.name?.charAt(0) || "?"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-sidebar-foreground truncate">
                      {user.name}
                    </p>
                    <p className="text-[11px] text-muted-foreground truncate">
                      {user.email}
                    </p>
                  </div>
                  <button
                    onClick={handleLogout}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors"
                  >
                    <LogOut className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 pb-20 md:pb-6">
          {routeAllowed ? (
            children
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
              <ShieldAlert className="h-10 w-10 text-muted-foreground" />
              <h2 className="text-lg font-semibold">Esta sección no está disponible para tu rol</h2>
              <p className="text-sm text-muted-foreground max-w-sm">
                Tu cuenta de {roleLabel(user.role).toLowerCase()} no tiene acceso a esta pantalla.
                Te llevamos de vuelta a tu zona de trabajo.
              </p>
            </div>
          )}
        </main>

        {/* Mobile bottom nav */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-background border-t z-40">
          <div className="flex items-center justify-around h-16">
            {mobileNavItems.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex flex-col items-center gap-1 px-3 py-2 text-xs transition-colors",
                    active
                      ? "text-primary font-medium"
                      : "text-muted-foreground"
                  )}
                >
                  <item.icon className="h-5 w-5" />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
