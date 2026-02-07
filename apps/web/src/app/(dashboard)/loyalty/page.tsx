"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@restai/ui/components/card";
import { Input } from "@restai/ui/components/input";
import { Label } from "@restai/ui/components/label";
import { DatePicker } from "@restai/ui/components/date-picker";
import { Button } from "@restai/ui/components/button";
import { Badge } from "@restai/ui/components/badge";
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from "@restai/ui/components/select";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@restai/ui/components/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@restai/ui/components/dialog";
import {
  Search,
  Plus,
  Star,
  Gift,
  RefreshCw,
  Users,
  Award,
  TrendingUp,
  CheckCircle2,
  Pencil,
  Trash2,
  Ticket,
  Copy,
  Tag,
  Send,
} from "lucide-react";
import {
  useLoyaltyStats,
  useLoyaltyCustomers,
  useLoyaltyPrograms,
  useLoyaltyRewards,
  useCreateCustomer,
  useCreateProgram,
  useCreateReward,
  useUpdateProgram,
  useDeleteProgram,
  useCreateTier,
  useUpdateTier,
  useDeleteTier,
} from "@/hooks/use-loyalty";
import {
  useCoupons,
  useCreateCoupon,
  useUpdateCoupon,
  useDeleteCoupon,
  useCouponAssignments,
  useAssignCoupon,
} from "@/hooks/use-coupons";
import { formatCurrency } from "@/lib/utils";
import { toast } from "sonner";

const tierConfig: Record<string, { label: string; color: string }> = {
  Bronce: {
    label: "Bronce",
    color: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
  },
  Plata: {
    label: "Plata",
    color: "bg-gray-100 text-gray-800 dark:bg-gray-700/40 dark:text-gray-300",
  },
  Oro: {
    label: "Oro",
    color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  },
  Platino: {
    label: "Platino",
    color: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  },
};

const couponTypeLabels: Record<string, string> = {
  percentage: "Porcentaje",
  fixed: "Monto fijo",
  item_free: "Item gratis",
  item_discount: "Descuento en item",
  category_discount: "Descuento en categoria",
  buy_x_get_y: "Compra X lleva Y",
};

const couponStatusLabels: Record<string, { label: string; color: string }> = {
  active: { label: "Activo", color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" },
  inactive: { label: "Inactivo", color: "bg-gray-100 text-gray-800 dark:bg-gray-700/40 dark:text-gray-300" },
  expired: { label: "Expirado", color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" },
};

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-muted rounded ${className ?? ""}`} />;
}

function generateCouponCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "REST-";
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// ---------------------------------------------------------------------------
// Stats Cards
// ---------------------------------------------------------------------------
function StatsCards() {
  const { data: stats, isLoading } = useLoyaltyStats();

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-4">
              <Skeleton className="h-4 w-24 mb-2" />
              <Skeleton className="h-8 w-16" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const items = [
    {
      label: "Clientes registrados",
      value: (stats?.totalCustomers ?? 0).toLocaleString(),
      icon: Users,
      color: "text-blue-600 dark:text-blue-400",
      bg: "bg-blue-100 dark:bg-blue-900/30",
    },
    {
      label: "Puntos en circulacion",
      value: (stats?.totalPointsBalance ?? 0).toLocaleString(),
      icon: Star,
      color: "text-yellow-600 dark:text-yellow-400",
      bg: "bg-yellow-100 dark:bg-yellow-900/30",
    },
    {
      label: "Recompensas canjeadas",
      value: (stats?.totalRedemptions ?? 0).toLocaleString(),
      icon: Gift,
      color: "text-green-600 dark:text-green-400",
      bg: "bg-green-100 dark:bg-green-900/30",
    },
    {
      label: "Programa activo",
      value: stats?.activeProgram ? "Si" : "No",
      icon: CheckCircle2,
      color: stats?.activeProgram
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-muted-foreground",
      bg: stats?.activeProgram
        ? "bg-emerald-100 dark:bg-emerald-900/30"
        : "bg-muted",
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {items.map((item) => (
        <Card key={item.label}>
          <CardContent className="p-4 flex items-center gap-4">
            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${item.bg}`}>
              <item.icon className={`h-5 w-5 ${item.color}`} />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground truncate">{item.label}</p>
              <p className="text-xl font-bold text-foreground">{item.value}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Create Customer Dialog
// ---------------------------------------------------------------------------
function CreateCustomerDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createCustomer = useCreateCustomer();
  const [form, setForm] = useState({ name: "", phone: "", email: "", birthDate: "" });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createCustomer.mutate(
      {
        name: form.name,
        phone: form.phone || undefined,
        email: form.email || undefined,
        birthDate: form.birthDate || undefined,
      },
      {
        onSuccess: () => {
          setForm({ name: "", phone: "", email: "", birthDate: "" });
          onOpenChange(false);
          toast.success("Cliente registrado exitosamente");
        },
        onError: (err) => toast.error(`Error: ${(err as Error).message}`),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Registrar Cliente</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="cust-name">Nombre *</Label>
            <Input id="cust-name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cust-phone">Telefono</Label>
            <Input id="cust-phone" value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cust-email">Email</Label>
            <Input id="cust-email" type="email" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cust-birth">Fecha de nacimiento</Label>
            <DatePicker id="cust-birth" value={form.birthDate} onChange={(d) => setForm((p) => ({ ...p, birthDate: d ?? "" }))} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={createCustomer.isPending || !form.name}>
              {createCustomer.isPending ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Create/Edit Program Dialog
// ---------------------------------------------------------------------------
function ProgramDialog({
  open,
  onOpenChange,
  editData,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editData?: any;
}) {
  const createProgram = useCreateProgram();
  const updateProgram = useUpdateProgram();
  const isEdit = !!editData;

  const [form, setForm] = useState({
    name: editData?.name || "Programa de Puntos",
    pointsPerCurrencyUnit: editData?.points_per_currency_unit || 1,
    currencyPerPoint: editData?.currency_per_point || 100,
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      name: form.name,
      pointsPerCurrencyUnit: form.pointsPerCurrencyUnit,
      currencyPerPoint: form.currencyPerPoint,
      isActive: true,
    };

    const mutation = isEdit ? updateProgram : createProgram;
    const data = isEdit ? { id: editData.id, ...payload } : payload;

    mutation.mutate(data, {
      onSuccess: () => {
        onOpenChange(false);
        toast.success(isEdit ? "Programa actualizado" : "Programa creado exitosamente");
      },
      onError: (err) => toast.error(`Error: ${(err as Error).message}`),
    });
  }

  // Points simulator
  const exampleSpend = 50;
  const pointsEarned = exampleSpend * form.pointsPerCurrencyUnit;
  const pointValue = form.currencyPerPoint / 100;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar Programa" : "Crear Programa de Fidelizacion"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="prog-name">Nombre del programa</Label>
            <Input id="prog-name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="prog-ppu">Puntos por sol gastado</Label>
            <Input
              id="prog-ppu"
              type="number"
              min={1}
              value={form.pointsPerCurrencyUnit}
              onChange={(e) => setForm((p) => ({ ...p, pointsPerCurrencyUnit: parseInt(e.target.value) || 1 }))}
            />
            <p className="text-xs text-muted-foreground">Cuantos puntos gana el cliente por cada S/ 1.00 gastado</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="prog-cpp">Valor por punto (centimos)</Label>
            <Input
              id="prog-cpp"
              type="number"
              min={1}
              value={form.currencyPerPoint}
              onChange={(e) => setForm((p) => ({ ...p, currencyPerPoint: parseInt(e.target.value) || 100 }))}
            />
            <p className="text-xs text-muted-foreground">Valor en centimos de cada punto al canjear (100 = S/ 1.00)</p>
          </div>

          {/* Simulator */}
          <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2">
            <p className="text-sm font-medium text-foreground">Vista previa</p>
            <p className="text-xs text-muted-foreground">
              Si tu cliente gasta <span className="font-bold text-foreground">S/ {exampleSpend}.00</span>, gana{" "}
              <span className="font-bold text-primary">{pointsEarned} puntos</span>.
            </p>
            <p className="text-xs text-muted-foreground">
              Con <span className="font-bold text-foreground">100 puntos</span> acumulados, puede canjear{" "}
              <span className="font-bold text-primary">S/ {(100 * pointValue).toFixed(2)}</span> en descuentos.
            </p>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={createProgram.isPending || updateProgram.isPending}>
              {(createProgram.isPending || updateProgram.isPending) ? "Guardando..." : isEdit ? "Guardar Cambios" : "Crear Programa"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Tier Dialog (Create/Edit)
// ---------------------------------------------------------------------------
function TierDialog({
  open,
  onOpenChange,
  programId,
  editData,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  programId: string;
  editData?: any;
}) {
  const createTier = useCreateTier();
  const updateTier = useUpdateTier();
  const isEdit = !!editData;

  const [form, setForm] = useState({
    name: editData?.name || "",
    minPoints: editData?.min_points || 0,
    multiplier: editData?.multiplier || 100,
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isEdit) {
      updateTier.mutate(
        { id: editData.id, name: form.name, minPoints: form.minPoints, multiplier: form.multiplier },
        {
          onSuccess: () => { onOpenChange(false); toast.success("Nivel actualizado"); },
          onError: (err) => toast.error(`Error: ${(err as Error).message}`),
        },
      );
    } else {
      createTier.mutate(
        { programId, name: form.name, minPoints: form.minPoints, multiplier: form.multiplier },
        {
          onSuccess: () => { setForm({ name: "", minPoints: 0, multiplier: 100 }); onOpenChange(false); toast.success("Nivel creado"); },
          onError: (err) => toast.error(`Error: ${(err as Error).message}`),
        },
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar Nivel" : "Crear Nivel"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tier-name">Nombre del nivel</Label>
            <Input id="tier-name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} required placeholder="Ej: Diamante" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tier-min">Puntos minimos</Label>
            <Input id="tier-min" type="number" min={0} value={form.minPoints} onChange={(e) => setForm((p) => ({ ...p, minPoints: parseInt(e.target.value) || 0 }))} />
            <p className="text-xs text-muted-foreground">Puntos necesarios para alcanzar este nivel</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tier-mult">Multiplicador (%)</Label>
            <Input id="tier-mult" type="number" min={100} value={form.multiplier} onChange={(e) => setForm((p) => ({ ...p, multiplier: parseInt(e.target.value) || 100 }))} />
            <p className="text-xs text-muted-foreground">100 = 1x, 150 = 1.5x, 200 = 2x puntos</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={createTier.isPending || updateTier.isPending || !form.name}>
              {(createTier.isPending || updateTier.isPending) ? "Guardando..." : isEdit ? "Guardar" : "Crear Nivel"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Create Reward Dialog
// ---------------------------------------------------------------------------
function CreateRewardDialog({
  open,
  onOpenChange,
  programId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  programId: string;
}) {
  const createReward = useCreateReward();
  const [form, setForm] = useState({
    name: "",
    description: "",
    pointsCost: 100,
    discountType: "percentage" as "percentage" | "fixed",
    discountValue: 10,
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    createReward.mutate(
      {
        programId,
        name: form.name,
        description: form.description || undefined,
        pointsCost: form.pointsCost,
        discountType: form.discountType,
        discountValue: form.discountValue,
      },
      {
        onSuccess: () => {
          setForm({ name: "", description: "", pointsCost: 100, discountType: "percentage", discountValue: 10 });
          onOpenChange(false);
          toast.success("Recompensa creada exitosamente");
        },
        onError: (err) => toast.error(`Error: ${(err as Error).message}`),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Crear Recompensa</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="rwd-name">Nombre *</Label>
            <Input id="rwd-name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rwd-desc">Descripcion</Label>
            <Input id="rwd-desc" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rwd-cost">Costo en puntos</Label>
            <Input id="rwd-cost" type="number" min={1} value={form.pointsCost} onChange={(e) => setForm((p) => ({ ...p, pointsCost: parseInt(e.target.value) || 1 }))} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rwd-dtype">Tipo de descuento</Label>
            <Select value={form.discountType} onValueChange={(v) => setForm((p) => ({ ...p, discountType: v as "percentage" | "fixed" }))}>
              <SelectTrigger>
                <SelectValue placeholder="Tipo de descuento" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="percentage">Porcentaje (%)</SelectItem>
                <SelectItem value="fixed">Monto fijo (centimos)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="rwd-dval">Valor del descuento</Label>
            <Input id="rwd-dval" type="number" min={1} value={form.discountValue} onChange={(e) => setForm((p) => ({ ...p, discountValue: parseInt(e.target.value) || 1 }))} />
            <p className="text-xs text-muted-foreground">
              {form.discountType === "percentage" ? "Porcentaje de descuento (ej. 10 = 10%)" : "Monto en centimos (ej. 500 = S/ 5.00)"}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={createReward.isPending || !form.name}>
              {createReward.isPending ? "Creando..." : "Crear Recompensa"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Create Coupon Dialog
// ---------------------------------------------------------------------------
function CreateCouponDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const createCoupon = useCreateCoupon();
  const [form, setForm] = useState({
    code: generateCouponCode(),
    name: "",
    description: "",
    type: "percentage" as string,
    discountValue: 10,
    menuItemId: "",
    categoryId: "",
    buyQuantity: 2,
    getQuantity: 1,
    minOrderAmount: 0,
    maxDiscountAmount: 0,
    maxUsesTotal: 0,
    maxUsesPerCustomer: 1,
    startsAt: "",
    expiresAt: "",
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload: any = {
      code: form.code,
      name: form.name,
      description: form.description || undefined,
      type: form.type,
    };

    if (["percentage", "fixed", "item_discount", "category_discount"].includes(form.type)) {
      payload.discountValue = form.discountValue;
    }
    if (["item_free", "item_discount"].includes(form.type) && form.menuItemId) {
      payload.menuItemId = form.menuItemId;
    }
    if (form.type === "category_discount" && form.categoryId) {
      payload.categoryId = form.categoryId;
    }
    if (form.type === "buy_x_get_y") {
      payload.buyQuantity = form.buyQuantity;
      payload.getQuantity = form.getQuantity;
    }
    if (form.minOrderAmount > 0) payload.minOrderAmount = form.minOrderAmount;
    if (form.maxDiscountAmount > 0) payload.maxDiscountAmount = form.maxDiscountAmount;
    if (form.maxUsesTotal > 0) payload.maxUsesTotal = form.maxUsesTotal;
    if (form.maxUsesPerCustomer > 0) payload.maxUsesPerCustomer = form.maxUsesPerCustomer;
    if (form.startsAt) payload.startsAt = form.startsAt;
    if (form.expiresAt) payload.expiresAt = form.expiresAt;

    createCoupon.mutate(payload, {
      onSuccess: () => {
        setForm({
          code: generateCouponCode(),
          name: "",
          description: "",
          type: "percentage",
          discountValue: 10,
          menuItemId: "",
          categoryId: "",
          buyQuantity: 2,
          getQuantity: 1,
          minOrderAmount: 0,
          maxDiscountAmount: 0,
          maxUsesTotal: 0,
          maxUsesPerCustomer: 1,
          startsAt: "",
          expiresAt: "",
        });
        onOpenChange(false);
        toast.success("Cupon creado exitosamente");
      },
      onError: (err) => toast.error(`Error: ${(err as Error).message}`),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Crear Cupon</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          {/* Code */}
          <div className="space-y-2">
            <Label htmlFor="cpn-code">Codigo del cupon</Label>
            <div className="flex gap-2">
              <Input id="cpn-code" value={form.code} onChange={(e) => setForm((p) => ({ ...p, code: e.target.value.toUpperCase() }))} required />
              <Button type="button" variant="outline" size="icon" onClick={() => setForm((p) => ({ ...p, code: generateCouponCode() }))}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="cpn-name">Nombre *</Label>
            <Input id="cpn-name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} required placeholder="Ej: 10% en tu primera compra" />
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="cpn-desc">Descripcion</Label>
            <Input id="cpn-desc" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} placeholder="Descripcion opcional" />
          </div>

          {/* Type */}
          <div className="space-y-2">
            <Label htmlFor="cpn-type">Tipo de cupon</Label>
            <Select value={form.type} onValueChange={(v) => setForm((p) => ({ ...p, type: v }))}>
              <SelectTrigger>
                <SelectValue placeholder="Tipo de cupon" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="percentage">Porcentaje de descuento (%)</SelectItem>
                <SelectItem value="fixed">Monto fijo de descuento</SelectItem>
                <SelectItem value="item_free">Item gratis</SelectItem>
                <SelectItem value="item_discount">Descuento en item especifico</SelectItem>
                <SelectItem value="category_discount">Descuento en categoria</SelectItem>
                <SelectItem value="buy_x_get_y">Compra X lleva Y</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Type-specific fields */}
          {form.type === "percentage" && (
            <div className="space-y-2">
              <Label htmlFor="cpn-pct">Porcentaje de descuento</Label>
              <Input id="cpn-pct" type="number" min={1} max={100} value={form.discountValue} onChange={(e) => setForm((p) => ({ ...p, discountValue: parseInt(e.target.value) || 0 }))} />
              <p className="text-xs text-muted-foreground">Ej: 10 = 10% de descuento</p>
            </div>
          )}

          {form.type === "fixed" && (
            <div className="space-y-2">
              <Label htmlFor="cpn-fixed">Monto de descuento (centimos)</Label>
              <Input id="cpn-fixed" type="number" min={1} value={form.discountValue} onChange={(e) => setForm((p) => ({ ...p, discountValue: parseInt(e.target.value) || 0 }))} />
              <p className="text-xs text-muted-foreground">En centimos: 500 = S/ 5.00</p>
            </div>
          )}

          {(form.type === "item_discount" || form.type === "category_discount") && (
            <div className="space-y-2">
              <Label htmlFor="cpn-dv">Descuento (%)</Label>
              <Input id="cpn-dv" type="number" min={1} max={100} value={form.discountValue} onChange={(e) => setForm((p) => ({ ...p, discountValue: parseInt(e.target.value) || 0 }))} />
            </div>
          )}

          {form.type === "buy_x_get_y" && (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="cpn-bx">Compra (X)</Label>
                <Input id="cpn-bx" type="number" min={1} value={form.buyQuantity} onChange={(e) => setForm((p) => ({ ...p, buyQuantity: parseInt(e.target.value) || 1 }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cpn-gy">Lleva gratis (Y)</Label>
                <Input id="cpn-gy" type="number" min={1} value={form.getQuantity} onChange={(e) => setForm((p) => ({ ...p, getQuantity: parseInt(e.target.value) || 1 }))} />
              </div>
            </div>
          )}

          {/* Common limits */}
          <div className="border-t border-border pt-4 space-y-4">
            <p className="text-sm font-medium text-foreground">Restricciones (opcional)</p>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="cpn-min">Pedido minimo (centimos)</Label>
                <Input id="cpn-min" type="number" min={0} value={form.minOrderAmount} onChange={(e) => setForm((p) => ({ ...p, minOrderAmount: parseInt(e.target.value) || 0 }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cpn-maxd">Descuento maximo (centimos)</Label>
                <Input id="cpn-maxd" type="number" min={0} value={form.maxDiscountAmount} onChange={(e) => setForm((p) => ({ ...p, maxDiscountAmount: parseInt(e.target.value) || 0 }))} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="cpn-uses">Usos totales (0 = ilimitado)</Label>
                <Input id="cpn-uses" type="number" min={0} value={form.maxUsesTotal} onChange={(e) => setForm((p) => ({ ...p, maxUsesTotal: parseInt(e.target.value) || 0 }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cpn-upc">Usos por cliente</Label>
                <Input id="cpn-upc" type="number" min={1} value={form.maxUsesPerCustomer} onChange={(e) => setForm((p) => ({ ...p, maxUsesPerCustomer: parseInt(e.target.value) || 1 }))} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="cpn-start">Fecha inicio</Label>
                <Input id="cpn-start" type="datetime-local" value={form.startsAt} onChange={(e) => setForm((p) => ({ ...p, startsAt: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cpn-end">Fecha fin</Label>
                <Input id="cpn-end" type="datetime-local" value={form.expiresAt} onChange={(e) => setForm((p) => ({ ...p, expiresAt: e.target.value }))} />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button type="submit" disabled={createCoupon.isPending || !form.name || !form.code}>
              {createCoupon.isPending ? "Creando..." : "Crear Cupon"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Onboarding Guide (shown when no program exists)
// ---------------------------------------------------------------------------
function OnboardingGuide({ onCreateProgram }: { onCreateProgram: () => void }) {
  const steps = [
    {
      number: 1, title: "Crea tu programa",
      description: "Define como tus clientes ganan puntos con cada compra. Configura la tasa de puntos por sol gastado.",
      icon: Star, color: "text-yellow-600 dark:text-yellow-400", bg: "bg-yellow-100 dark:bg-yellow-900/30",
    },
    {
      number: 2, title: "Registra clientes",
      description: "Agrega clientes manualmente o deja que se registren automaticamente al escanear el QR de la mesa.",
      icon: Users, color: "text-blue-600 dark:text-blue-400", bg: "bg-blue-100 dark:bg-blue-900/30",
    },
    {
      number: 3, title: "Puntos automaticos",
      description: "Los clientes acumulan puntos automaticamente cada vez que completan un pedido en tu restaurante.",
      icon: TrendingUp, color: "text-green-600 dark:text-green-400", bg: "bg-green-100 dark:bg-green-900/30",
    },
    {
      number: 4, title: "Crea recompensas",
      description: "Define descuentos y beneficios que tus clientes pueden canjear con sus puntos acumulados.",
      icon: Gift, color: "text-purple-600 dark:text-purple-400", bg: "bg-purple-100 dark:bg-purple-900/30",
    },
  ];

  return (
    <div className="space-y-6">
      <div className="text-center py-4">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
          <Award className="h-8 w-8 text-primary" />
        </div>
        <h2 className="text-xl font-semibold text-foreground mb-2">Configura tu programa de fidelizacion</h2>
        <p className="text-muted-foreground max-w-md mx-auto">
          Recompensa a tus clientes frecuentes y aumenta la retencion con un sistema de puntos facil de usar.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {steps.map((step) => (
          <Card key={step.number} className="relative overflow-hidden">
            <CardContent className="p-5">
              <div className="flex items-start gap-4">
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${step.bg}`}>
                  <step.icon className={`h-5 w-5 ${step.color}`} />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium text-muted-foreground">Paso {step.number}</span>
                  </div>
                  <p className="font-medium text-sm text-foreground">{step.title}</p>
                  <p className="text-xs text-muted-foreground mt-1">{step.description}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="flex justify-center">
        <Button size="lg" onClick={onCreateProgram}>
          <Plus className="h-4 w-4 mr-2" />
          Comenzar - Crear Programa
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Programs Tab (redesigned with edit/delete, tier management, simulator)
// ---------------------------------------------------------------------------
function ProgramsTab() {
  const { data, isLoading } = useLoyaltyPrograms();
  const { data: stats } = useLoyaltyStats();
  const deleteProgram = useDeleteProgram();
  const deleteTier = useDeleteTier();

  const [showCreate, setShowCreate] = useState(false);
  const [editProgram, setEditProgram] = useState<any>(null);
  const [tierDialog, setTierDialog] = useState<{ open: boolean; programId: string; editData?: any }>({ open: false, programId: "" });
  const [deleteConfirm, setDeleteConfirm] = useState<{ type: string; id: string; name: string } | null>(null);

  const programs: any[] = data ?? [];

  if (isLoading) {
    return <div className="space-y-4"><Skeleton className="h-32 w-full" /></div>;
  }

  if (programs.length === 0) {
    return (
      <div className="space-y-4">
        <OnboardingGuide onCreateProgram={() => setShowCreate(true)} />
        <ProgramDialog open={showCreate} onOpenChange={setShowCreate} />
      </div>
    );
  }

  function handleDelete() {
    if (!deleteConfirm) return;
    if (deleteConfirm.type === "program") {
      deleteProgram.mutate(deleteConfirm.id, {
        onSuccess: () => { setDeleteConfirm(null); toast.success("Programa eliminado"); },
        onError: (err) => toast.error(`Error: ${(err as Error).message}`),
      });
    } else if (deleteConfirm.type === "tier") {
      deleteTier.mutate(deleteConfirm.id, {
        onSuccess: () => { setDeleteConfirm(null); toast.success("Nivel eliminado"); },
        onError: (err) => toast.error(`Error: ${(err as Error).message}`),
      });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Nuevo Programa
        </Button>
      </div>

      {programs.map((program: any) => {
        const exampleSpend = 50;
        const pointsEarned = exampleSpend * program.points_per_currency_unit;
        const pointValue = program.currency_per_point / 100;

        return (
          <Card key={program.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>{program.name}</CardTitle>
                  <CardDescription>{program.is_active ? "Programa activo" : "Programa inactivo"}</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={program.is_active ? "default" : "secondary"}>
                    {program.is_active ? "Activo" : "Inactivo"}
                  </Badge>
                  <Button variant="ghost" size="icon" onClick={() => setEditProgram(program)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => setDeleteConfirm({ type: "program", id: program.id, name: program.name })}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-lg border border-border bg-muted/30 p-4">
                  <p className="text-sm text-muted-foreground">Puntos por sol</p>
                  <p className="text-2xl font-bold text-foreground">{program.points_per_currency_unit}</p>
                  <p className="text-xs text-muted-foreground">por cada S/ 1.00 gastado</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/30 p-4">
                  <p className="text-sm text-muted-foreground">Valor por punto</p>
                  <p className="text-2xl font-bold text-foreground">{formatCurrency(program.currency_per_point)}</p>
                  <p className="text-xs text-muted-foreground">al canjear recompensas</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/30 p-4">
                  <p className="text-sm text-muted-foreground">Clientes inscritos</p>
                  <p className="text-2xl font-bold text-foreground">{(stats?.totalCustomers ?? 0).toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground">registrados en total</p>
                </div>
                <div className="rounded-lg border border-border bg-muted/30 p-4">
                  <p className="text-sm text-muted-foreground">Simulacion</p>
                  <p className="text-sm text-foreground mt-1">
                    Con <span className="font-bold">S/ {exampleSpend}.00</span> gana <span className="font-bold text-primary">{pointsEarned} pts</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    100 pts = S/ {(100 * pointValue).toFixed(2)}
                  </p>
                </div>
              </div>

              {/* Tiers section */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-medium text-foreground">Niveles</p>
                  <Button variant="outline" size="sm" onClick={() => setTierDialog({ open: true, programId: program.id })}>
                    <Plus className="h-3 w-3 mr-1" />
                    Agregar Nivel
                  </Button>
                </div>
                {program.tiers && program.tiers.length > 0 ? (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    {program.tiers.map((tier: any) => {
                      const tc = tierConfig[tier.name] || { label: tier.name, color: "bg-gray-100 text-gray-800 dark:bg-gray-700/40 dark:text-gray-300" };
                      return (
                        <div key={tier.id} className="rounded-lg border border-border bg-muted/20 p-3 group relative">
                          <div className="absolute top-2 right-2 hidden group-hover:flex gap-1">
                            <button onClick={() => setTierDialog({ open: true, programId: program.id, editData: tier })} className="p-1 rounded hover:bg-muted">
                              <Pencil className="h-3 w-3 text-muted-foreground" />
                            </button>
                            <button onClick={() => setDeleteConfirm({ type: "tier", id: tier.id, name: tier.name })} className="p-1 rounded hover:bg-muted">
                              <Trash2 className="h-3 w-3 text-destructive" />
                            </button>
                          </div>
                          <span className={`text-xs px-2 py-1 rounded-full font-medium ${tc.color}`}>
                            {tc.label}
                          </span>
                          <p className="text-sm mt-2 text-foreground">{tier.min_points.toLocaleString()} pts minimo</p>
                          <p className="text-xs text-muted-foreground">Multiplicador: {(tier.multiplier / 100).toFixed(2)}x</p>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">No hay niveles configurados</p>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}

      <ProgramDialog open={showCreate} onOpenChange={setShowCreate} />
      {editProgram && (
        <ProgramDialog open={!!editProgram} onOpenChange={(v) => { if (!v) setEditProgram(null); }} editData={editProgram} />
      )}
      {tierDialog.open && (
        <TierDialog
          open={tierDialog.open}
          onOpenChange={(v) => { if (!v) setTierDialog({ open: false, programId: "" }); }}
          programId={tierDialog.programId}
          editData={tierDialog.editData}
        />
      )}

      {/* Delete confirmation */}
      <Dialog open={!!deleteConfirm} onOpenChange={(v) => { if (!v) setDeleteConfirm(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar eliminacion</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Estas seguro de eliminar <span className="font-bold text-foreground">{deleteConfirm?.name}</span>? Esta accion no se puede deshacer.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteProgram.isPending || deleteTier.isPending}>
              {(deleteProgram.isPending || deleteTier.isPending) ? "Eliminando..." : "Eliminar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Customers Tab
// ---------------------------------------------------------------------------
function CustomersTab() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  function handleSearch(val: string) {
    setSearch(val);
    if (timer) clearTimeout(timer);
    const t = setTimeout(() => setDebouncedSearch(val), 300);
    setTimer(t);
  }

  const { data, isLoading, error, refetch } = useLoyaltyCustomers(debouncedSearch || undefined);
  const customers: any[] = data ?? [];

  if (error) {
    return (
      <div className="p-4 rounded-lg border border-destructive/50 bg-destructive/10 flex items-center justify-between">
        <p className="text-sm text-destructive">Error al cargar clientes: {(error as Error).message}</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />Reintentar
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por nombre, email o telefono..." value={search} onChange={(e) => handleSearch(e.target.value)} className="pl-9" />
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-2" />Registrar Cliente
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/50">
                  <th className="text-left p-3 text-sm font-medium text-muted-foreground">Cliente</th>
                  <th className="text-left p-3 text-sm font-medium text-muted-foreground hidden sm:table-cell">Telefono</th>
                  <th className="text-center p-3 text-sm font-medium text-muted-foreground">Tier</th>
                  <th className="text-right p-3 text-sm font-medium text-muted-foreground">Puntos</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b border-border">
                      <td className="p-3"><Skeleton className="h-4 w-28" /></td>
                      <td className="p-3 hidden sm:table-cell"><Skeleton className="h-4 w-20" /></td>
                      <td className="p-3"><Skeleton className="h-5 w-14 mx-auto rounded-full" /></td>
                      <td className="p-3"><Skeleton className="h-4 w-12 ml-auto" /></td>
                    </tr>
                  ))
                ) : customers.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="p-8 text-center text-sm text-muted-foreground">
                      {debouncedSearch ? "No se encontraron clientes" : "No hay clientes registrados"}
                    </td>
                  </tr>
                ) : (
                  customers.map((customer: any) => {
                    const tierName = customer.tier_name || "Bronce";
                    const tier = tierConfig[tierName] || tierConfig.Bronce;
                    return (
                      <tr key={customer.id} className="border-b border-border last:border-0 hover:bg-muted/50 transition-colors">
                        <td className="p-3">
                          <Link href={`/loyalty/${customer.id}`} className="block">
                            <p className="font-medium text-sm text-foreground">{customer.name}</p>
                            {customer.email && <p className="text-xs text-muted-foreground">{customer.email}</p>}
                          </Link>
                        </td>
                        <td className="p-3 text-sm text-foreground hidden sm:table-cell">{customer.phone || "-"}</td>
                        <td className="p-3 text-center">
                          <span className={`text-xs px-2 py-1 rounded-full font-medium ${tier.color}`}>{tier.label}</span>
                        </td>
                        <td className="p-3 text-sm font-medium text-right text-foreground">{(customer.points_balance || 0).toLocaleString()}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <CreateCustomerDialog open={showCreate} onOpenChange={setShowCreate} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rewards Tab
// ---------------------------------------------------------------------------
function RewardsTab() {
  const { data: rewards, isLoading: rewardsLoading } = useLoyaltyRewards();
  const { data: programs } = useLoyaltyPrograms();
  const [showCreate, setShowCreate] = useState(false);

  const rewardsList: any[] = rewards ?? [];
  const programsList: any[] = programs ?? [];
  const programId = programsList[0]?.id;

  if (rewardsLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-5">
              <Skeleton className="h-5 w-32 mb-3" />
              <Skeleton className="h-4 w-48 mb-4" />
              <Skeleton className="h-10 w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setShowCreate(true)} disabled={!programId}>
          <Plus className="h-4 w-4 mr-2" />Crear Recompensa
        </Button>
      </div>

      {!programId && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Award className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">Debes crear un programa de fidelizacion primero</p>
          </CardContent>
        </Card>
      )}

      {rewardsList.length === 0 && programId && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Gift className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-1">No hay recompensas creadas</p>
            <p className="text-xs text-muted-foreground">Crea recompensas para que tus clientes canjeen sus puntos</p>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {rewardsList.map((reward: any) => (
          <Card key={reward.id} className="relative overflow-hidden">
            <div className="absolute top-0 right-0 bg-primary text-primary-foreground px-3 py-1.5 rounded-bl-lg">
              <p className="text-sm font-bold">{reward.points_cost.toLocaleString()} pts</p>
            </div>
            <CardContent className="p-5 pt-4">
              <div className="pr-20">
                <p className="font-semibold text-foreground">{reward.name}</p>
                {reward.description && <p className="text-xs text-muted-foreground mt-1">{reward.description}</p>}
              </div>
              <div className="mt-4 flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">
                  {reward.discount_type === "percentage" ? `${reward.discount_value}% descuento` : `${formatCurrency(reward.discount_value)} descuento`}
                </Badge>
                {reward.is_active && (
                  <Badge variant="outline" className="text-xs text-green-600 border-green-300 dark:text-green-400 dark:border-green-700">Activa</Badge>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {programId && <CreateRewardDialog open={showCreate} onOpenChange={setShowCreate} programId={programId} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Assign Coupon Dialog
// ---------------------------------------------------------------------------
function AssignCouponDialog({
  open,
  onOpenChange,
  coupon,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  coupon: any;
}) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const assignCoupon = useAssignCoupon();

  const { data: customersData, isLoading: customersLoading } = useLoyaltyCustomers(debouncedSearch || undefined);
  const { data: assignmentsData } = useCouponAssignments(coupon?.id || "");

  const customers: any[] = customersData ?? [];
  const assignments: any[] = assignmentsData ?? [];
  const assignedCustomerIds = new Set(assignments.map((a: any) => a.customer_id));

  function handleSearch(val: string) {
    setSearch(val);
    if (timer) clearTimeout(timer);
    const t = setTimeout(() => setDebouncedSearch(val), 300);
    setTimer(t);
  }

  function toggleCustomer(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function handleAssign() {
    if (selectedIds.length === 0) return;
    assignCoupon.mutate(
      { couponId: coupon.id, customerIds: selectedIds },
      {
        onSuccess: () => {
          setSelectedIds([]);
          toast.success(`Cupon asignado a ${selectedIds.length} cliente(s)`);
          onOpenChange(false);
        },
        onError: (err) => toast.error(`Error: ${(err as Error).message}`),
      },
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Asignar Cupon: {coupon?.code}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar clientes..."
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Already assigned */}
          {assignments.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">
                Ya asignados ({assignments.length}):
              </p>
              <div className="flex flex-wrap gap-1">
                {assignments.map((a: any) => (
                  <span
                    key={a.id}
                    className="text-xs px-2 py-1 rounded-full bg-muted text-muted-foreground"
                  >
                    {a.customer_name || "Sin nombre"}
                    {a.seen_at && " (visto)"}
                    {a.used_at && " (usado)"}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Customer list */}
          <div className="max-h-60 overflow-y-auto border border-border rounded-lg">
            {customersLoading ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                Cargando...
              </div>
            ) : customers.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">
                {debouncedSearch ? "Sin resultados" : "No hay clientes"}
              </div>
            ) : (
              customers.map((cust: any) => {
                const alreadyAssigned = assignedCustomerIds.has(cust.id);
                const isSelected = selectedIds.includes(cust.id);
                return (
                  <button
                    key={cust.id}
                    disabled={alreadyAssigned}
                    onClick={() => toggleCustomer(cust.id)}
                    className={`w-full flex items-center justify-between p-3 text-left border-b border-border last:border-0 transition-colors ${
                      alreadyAssigned
                        ? "opacity-50 cursor-not-allowed bg-muted/30"
                        : isSelected
                          ? "bg-primary/10"
                          : "hover:bg-muted/50"
                    }`}
                  >
                    <div>
                      <p className="text-sm font-medium">{cust.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {cust.phone || cust.email || "Sin contacto"}
                      </p>
                    </div>
                    {alreadyAssigned ? (
                      <span className="text-xs text-muted-foreground">Asignado</span>
                    ) : isSelected ? (
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                    ) : null}
                  </button>
                );
              })
            )}
          </div>

          {selectedIds.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {selectedIds.length} cliente(s) seleccionado(s)
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleAssign}
            disabled={assignCoupon.isPending || selectedIds.length === 0}
          >
            {assignCoupon.isPending
              ? "Asignando..."
              : `Asignar (${selectedIds.length})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Coupons Tab
// ---------------------------------------------------------------------------
function CouponsTab() {
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const { data, isLoading, error, refetch } = useCoupons({
    status: statusFilter === "all" ? undefined : statusFilter,
    type: typeFilter === "all" ? undefined : typeFilter,
  });
  const deleteCoupon = useDeleteCoupon();
  const updateCoupon = useUpdateCoupon();
  const [showCreate, setShowCreate] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [assignCoupon, setAssignCoupon] = useState<any>(null);

  const couponsList: any[] = data ?? [];

  function handleCopyCode(code: string) {
    navigator.clipboard.writeText(code);
    toast.success(`Codigo "${code}" copiado`);
  }

  function handleToggleStatus(coupon: any) {
    const newStatus = coupon.status === "active" ? "inactive" : "active";
    updateCoupon.mutate(
      { id: coupon.id, status: newStatus },
      {
        onSuccess: () => toast.success(`Cupon ${newStatus === "active" ? "activado" : "desactivado"}`),
        onError: (err) => toast.error(`Error: ${(err as Error).message}`),
      },
    );
  }

  function handleDelete() {
    if (!deleteConfirm) return;
    deleteCoupon.mutate(deleteConfirm.id, {
      onSuccess: () => { setDeleteConfirm(null); toast.success("Cupon eliminado"); },
      onError: (err) => toast.error(`Error: ${(err as Error).message}`),
    });
  }

  function formatCouponValue(coupon: any): string {
    switch (coupon.type) {
      case "percentage": return `${coupon.discount_value}% off`;
      case "fixed": return `${formatCurrency(coupon.discount_value)} off`;
      case "item_free": return "Item gratis";
      case "item_discount": return `${coupon.discount_value}% en item`;
      case "category_discount": return `${coupon.discount_value}% en categoria`;
      case "buy_x_get_y": return `${coupon.buy_quantity}x${coupon.get_quantity}`;
      default: return "-";
    }
  }

  if (error) {
    return (
      <div className="p-4 rounded-lg border border-destructive/50 bg-destructive/10 flex items-center justify-between">
        <p className="text-sm text-destructive">Error al cargar cupones: {(error as Error).message}</p>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />Reintentar
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters + Create */}
      <div className="flex flex-wrap gap-2 items-center">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Todos los estados" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            <SelectItem value="active">Activos</SelectItem>
            <SelectItem value="inactive">Inactivos</SelectItem>
            <SelectItem value="expired">Expirados</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Todos los tipos" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los tipos</SelectItem>
            <SelectItem value="percentage">Porcentaje</SelectItem>
            <SelectItem value="fixed">Monto fijo</SelectItem>
            <SelectItem value="item_free">Item gratis</SelectItem>
            <SelectItem value="item_discount">Descuento en item</SelectItem>
            <SelectItem value="category_discount">Descuento en categoria</SelectItem>
            <SelectItem value="buy_x_get_y">Compra X lleva Y</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto">
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4 mr-2" />Crear Cupon
          </Button>
        </div>
      </div>

      {/* Coupon cards */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}><CardContent className="p-5"><Skeleton className="h-24 w-full" /></CardContent></Card>
          ))}
        </div>
      ) : couponsList.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Ticket className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground mb-1">No hay cupones creados</p>
            <p className="text-xs text-muted-foreground">Crea cupones de descuento para tus clientes</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {couponsList.map((coupon: any) => {
            const statusInfo = couponStatusLabels[coupon.status] || couponStatusLabels.inactive;
            const isExpired = coupon.expires_at && new Date(coupon.expires_at) < new Date();
            return (
              <Card key={coupon.id} className="relative overflow-hidden">
                {/* Coupon-style dashed border top */}
                <div className="border-b-2 border-dashed border-border" />
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <button
                          onClick={() => handleCopyCode(coupon.code)}
                          className="flex items-center gap-1 font-mono text-sm font-bold text-primary hover:text-primary/80 transition-colors"
                        >
                          <Copy className="h-3 w-3" />
                          {coupon.code}
                        </button>
                      </div>
                      <p className="font-medium text-foreground text-sm">{coupon.name}</p>
                      {coupon.description && (
                        <p className="text-xs text-muted-foreground mt-0.5">{coupon.description}</p>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button
                        onClick={() => setAssignCoupon(coupon)}
                        className="p-1.5 rounded hover:bg-muted"
                        title="Asignar a clientes"
                      >
                        <Send className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                      </button>
                      <button
                        onClick={() => handleToggleStatus(coupon)}
                        className="p-1.5 rounded hover:bg-muted"
                        title={coupon.status === "active" ? "Desactivar" : "Activar"}
                      >
                        <CheckCircle2 className={`h-4 w-4 ${coupon.status === "active" ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`} />
                      </button>
                      <button onClick={() => setDeleteConfirm({ id: coupon.id, name: coupon.name })} className="p-1.5 rounded hover:bg-muted">
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusInfo.color}`}>
                      {isExpired ? "Expirado" : statusInfo.label}
                    </span>
                    <Badge variant="secondary" className="text-xs">
                      <Tag className="h-3 w-3 mr-1" />
                      {couponTypeLabels[coupon.type] || coupon.type}
                    </Badge>
                    <Badge variant="outline" className="text-xs font-bold">
                      {formatCouponValue(coupon)}
                    </Badge>
                  </div>

                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      Usos: {coupon.current_uses}{coupon.max_uses_total ? `/${coupon.max_uses_total}` : " (ilim.)"}
                    </span>
                    {coupon.min_order_amount > 0 && (
                      <span>Min: {formatCurrency(coupon.min_order_amount)}</span>
                    )}
                  </div>

                  {(coupon.starts_at || coupon.expires_at) && (
                    <div className="mt-2 text-xs text-muted-foreground">
                      {coupon.starts_at && (
                        <span>Desde: {new Date(coupon.starts_at).toLocaleDateString("es-PE")} </span>
                      )}
                      {coupon.expires_at && (
                        <span>Hasta: {new Date(coupon.expires_at).toLocaleDateString("es-PE")}</span>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <CreateCouponDialog open={showCreate} onOpenChange={setShowCreate} />

      {assignCoupon && (
        <AssignCouponDialog
          open={!!assignCoupon}
          onOpenChange={(v) => { if (!v) setAssignCoupon(null); }}
          coupon={assignCoupon}
        />
      )}

      {/* Delete confirmation */}
      <Dialog open={!!deleteConfirm} onOpenChange={(v) => { if (!v) setDeleteConfirm(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminar cupon</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Estas seguro de eliminar el cupon <span className="font-bold text-foreground">{deleteConfirm?.name}</span>?
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>Cancelar</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteCoupon.isPending}>
              {deleteCoupon.isPending ? "Eliminando..." : "Eliminar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------
export default function LoyaltyPage() {
  const [tab, setTab] = useState("programs");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Fidelizacion</h1>
        <p className="text-muted-foreground">
          Gestiona tus clientes, programa de puntos, recompensas y cupones
        </p>
      </div>

      <StatsCards />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="programs">
            <Star className="h-4 w-4 mr-2" />
            Programas
          </TabsTrigger>
          <TabsTrigger value="customers">
            <Users className="h-4 w-4 mr-2" />
            Clientes
          </TabsTrigger>
          <TabsTrigger value="rewards">
            <Gift className="h-4 w-4 mr-2" />
            Recompensas
          </TabsTrigger>
          <TabsTrigger value="coupons">
            <Ticket className="h-4 w-4 mr-2" />
            Cupones
          </TabsTrigger>
        </TabsList>

        <TabsContent value="programs">
          <ProgramsTab />
        </TabsContent>
        <TabsContent value="customers">
          <CustomersTab />
        </TabsContent>
        <TabsContent value="rewards">
          <RewardsTab />
        </TabsContent>
        <TabsContent value="coupons">
          <CouponsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
