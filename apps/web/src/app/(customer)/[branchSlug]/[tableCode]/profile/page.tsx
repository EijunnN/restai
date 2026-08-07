"use client";

import { use, useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useCustomerStore } from "@/stores/customer-store";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@restai/ui/components/button";
import { Card, CardContent, CardHeader, CardTitle } from "@restai/ui/components/card";
import { Badge } from "@restai/ui/components/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@restai/ui/components/dialog";
import {
  AlertCircle,
  ArrowLeft,
  Star,
  Gift,
  TrendingUp,
  Loader2,
  CheckCircle,
  RefreshCcw,
  ShoppingBag,
  Ticket,
  User,
  History,
  Users,
  Copy,
  Check,
  Share2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { describeReward, rewardKindLabel } from "@/components/customer/reward-label";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

interface RewardData {
  id: string;
  name: string;
  description: string | null;
  points_cost: number;
  // Sin `reward_type` una recompensa de producto gratis se pintaba como
  // "S/ 0.00 de descuento" y nadie la canjeaba.
  reward_type?: string | null;
  discount_type: string | null;
  discount_value: number | null;
  menu_item_id?: string | null;
  menu_item_name?: string | null;
  stock_remaining?: number | null;
}

interface LoyaltyData {
  points_balance: number;
  total_points_earned: number;
  program_name: string;
  tier_name: string | null;
  next_tier: { name: string; min_points: number } | null;
  rewards: RewardData[];
}

interface RedemptionData {
  id: string;
  reward_name: string;
  reward_type?: string | null;
  discount_type: string | null;
  discount_value: number | null;
  menu_item_id?: string | null;
  points_spent?: number | null;
  redeemed_at: string;
}

interface CouponData {
  id: string;
  code: string;
  name: string;
  description: string | null;
  type: string;
  discount_value: number;
  expires_at: string | null;
}

interface OrderData {
  id: string;
  order_number: string;
  status: string;
  total: number | null;
  created_at: string;
  items: Array<{ id: string; name: string; quantity: number; status: string }>;
}

// Loyalty points history row. Tolerant of snake_case/camelCase shapes from the
// my-transactions endpoint; `points` is signed (negative for redeemed/expired).
interface TransactionData {
  id: string;
  points: number;
  type: string;
  description?: string | null;
  created_at?: string | null;
  createdAt?: string | null;
  expires_at?: string | null;
  expiresAt?: string | null;
  expired?: boolean;
}

const txTypeLabels: Record<string, string> = {
  earned: "Ganados",
  redeemed: "Canjeados",
  adjusted: "Ajuste",
  expired: "Expirados",
};

const orderStatusLabels: Record<string, string> = {
  pending: "Pendiente",
  confirmed: "Confirmado",
  preparing: "Preparando",
  ready: "Listo",
  served: "Servido",
  completed: "Completado",
  cancelled: "Cancelado",
};

const orderStatusVariants: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20",
  confirmed: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/20",
  preparing: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/20",
  ready: "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/20",
  served: "bg-muted text-muted-foreground border-border",
  completed: "bg-muted text-muted-foreground border-border",
  cancelled: "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/20",
};

export default function ProfilePage({
  params,
}: {
  params: Promise<{ branchSlug: string; tableCode: string }>;
}) {
  const { branchSlug, tableCode } = use(params);

  const storeToken = useCustomerStore((s) => s.token);
  const storeCustomerName = useCustomerStore((s) => s.customerName);
  // Nombre del local para personalizar la invitación que se comparte.
  const branchName = useCustomerStore((s) => s.branchName);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loyalty, setLoyalty] = useState<LoyaltyData | null>(null);
  const [redemptions, setRedemptions] = useState<RedemptionData[]>([]);
  const [coupons, setCoupons] = useState<CouponData[]>([]);
  const [orders, setOrders] = useState<OrderData[]>([]);
  const [transactions, setTransactions] = useState<TransactionData[]>([]);
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Nombres de la carta para poder decir "Postre Tres Leches gratis" en un canje
  // ya hecho: /my-redemptions devuelve el id del plato, no su nombre.
  const [menuItemNames, setMenuItemNames] = useState<Record<string, string>>({});
  // NÚMERO de mesa: el segmento `tableCode` de la URL es el qr_code interno
  // ("mi-sede-T7-lx8k2a") y se estaba pintando literal bajo el nombre del
  // cliente. Viaja en la misma respuesta de la carta que ya se pedía.
  const [tableNumber, setTableNumber] = useState<number | null>(null);

  // Redeem dialog
  const [redeemDialogOpen, setRedeemDialogOpen] = useState(false);
  const [selectedReward, setSelectedReward] = useState<RewardData | null>(null);
  const [redeeming, setRedeeming] = useState(false);
  const [successDialogOpen, setSuccessDialogOpen] = useState(false);
  const [redeemResult, setRedeemResult] = useState<{ reward: RewardData; newBalance: number } | null>(null);

  const customerName = storeCustomerName || (typeof window !== "undefined" ? sessionStorage.getItem("customer_name") : null);

  const getToken = useCallback(() => {
    if (storeToken) return storeToken;
    if (typeof window !== "undefined") return sessionStorage.getItem("customer_token");
    return null;
  }, [storeToken]);

  // La carta pública sirve para traducir menu_item_id → nombre del plato.
  const loadMenuNames = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/customer/${branchSlug}/${tableCode}/menu`);
      const result = await res.json();
      if (!result?.success) return;
      if (typeof result.data?.table?.number === "number") {
        setTableNumber(result.data.table.number);
      }
      if (!Array.isArray(result.data?.items)) return;
      const names: Record<string, string> = {};
      for (const item of result.data.items as Array<{ id: string; name: string }>) {
        names[item.id] = item.name;
      }
      setMenuItemNames(names);
    } catch {
      // Sin nombres se dice "Un producto gratis": suficiente, nunca "S/ 0.00".
    }
  }, [branchSlug, tableCode]);

  const fetchAll = useCallback(async () => {
    const token = getToken();
    if (!token) {
      setLoadError("Tu sesión no está activa. Vuelve a escanear el código de la mesa.");
      setLoading(false);
      return;
    }

    const headers = { Authorization: `Bearer ${token}` };

    try {
      const [loyaltyRes, couponsRes, ordersRes, redemptionsRes, transactionsRes, referralRes] = await Promise.all([
        fetch(`${API_URL}/api/customer/my-loyalty`, { headers }),
        fetch(`${API_URL}/api/customer/my-coupons`, { headers }),
        fetch(`${API_URL}/api/customer/my-orders`, { headers }),
        fetch(`${API_URL}/api/customer/my-redemptions`, { headers }),
        fetch(`${API_URL}/api/customer/my-transactions`, { headers }),
        fetch(`${API_URL}/api/customer/my-referral-code`, { headers }),
      ]);

      const [loyaltyData, couponsData, ordersData, redemptionsData, transactionsData, referralData] = await Promise.all([
        loyaltyRes.json(),
        couponsRes.json(),
        ordersRes.json(),
        redemptionsRes.json(),
        transactionsRes.json().catch(() => ({ success: false })),
        referralRes.json().catch(() => ({ success: false })),
      ]);

      // Token caducado o de otra mesa: TODAS las peticiones devuelven 401/403 y
      // la pantalla pintaba "Aún no tienes actividad", que es mentira y hace
      // creer al comensal que ha perdido sus puntos.
      if (loyaltyRes.status === 401 || loyaltyRes.status === 403) {
        setLoadError(
          "Tu sesión ha caducado. Vuelve a escanear el código de la mesa para ver tus puntos.",
        );
        return;
      }

      if (loyaltyData.success && loyaltyData.data) setLoyalty(loyaltyData.data);
      if (couponsData.success) setCoupons(couponsData.data || []);
      if (ordersData.success) setOrders(ordersData.data || []);
      if (redemptionsData.success) setRedemptions(redemptionsData.data || []);
      if (transactionsData.success) setTransactions(transactionsData.data || []);
      if (referralData.success && referralData.data) {
        // Tolerant of `{ code: "..." }` or a bare string payload.
        const code =
          typeof referralData.data === "string"
            ? referralData.data
            : referralData.data.code;
        if (code) setReferralCode(code);
      }
      setLoadError(null);
    } catch {
      // El silencio ante un fallo hace concluir "la app no funciona": se explica
      // y se ofrece reintentar.
      setLoadError("No pudimos cargar tu perfil. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    void loadMenuNames();
  }, [loadMenuNames]);

  const handleRedeemClick = (reward: RewardData) => {
    setSelectedReward(reward);
    setRedeemDialogOpen(true);
  };

  const handleConfirmRedeem = async () => {
    if (!selectedReward) return;
    const token = getToken();
    if (!token) return;

    try {
      setRedeeming(true);
      const res = await fetch(`${API_URL}/api/customer/redeem-reward`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ rewardId: selectedReward.id }),
      });
      const result = await res.json();

      if (!result.success) {
        throw new Error(result.error?.message || "No pudimos canjear la recompensa");
      }

      setRedeemResult({
        reward: selectedReward,
        newBalance: result.data?.newBalance ?? 0,
      });
      setRedeemDialogOpen(false);
      setSuccessDialogOpen(true);

      // Re-fetch loyalty + redemptions + points history
      const headers = { Authorization: `Bearer ${token}` };
      const [loyaltyRes, redemptionsRes, transactionsRes] = await Promise.all([
        fetch(`${API_URL}/api/customer/my-loyalty`, { headers }),
        fetch(`${API_URL}/api/customer/my-redemptions`, { headers }),
        fetch(`${API_URL}/api/customer/my-transactions`, { headers }),
      ]);
      const [loyaltyData, redemptionsData, transactionsData] = await Promise.all([
        loyaltyRes.json(),
        redemptionsRes.json(),
        transactionsRes.json().catch(() => ({ success: false })),
      ]);
      if (loyaltyData.success && loyaltyData.data) setLoyalty(loyaltyData.data);
      if (redemptionsData.success) setRedemptions(redemptionsData.data || []);
      if (transactionsData.success) setTransactions(transactionsData.data || []);
    } catch (err) {
      // Un canje que falla en silencio es puntos que el comensal cree perdidos.
      toast.error(
        err instanceof Error ? err.message : "No pudimos canjear la recompensa",
      );
    } finally {
      setRedeeming(false);
    }
  };

  /**
   * Enlace de invitación completo.
   *
   * Se compartía SOLO el código suelto ("Usa mi código ABC123"), y como el
   * código únicamente entra por el parámetro `?ref=`, quien lo recibía no tenía
   * forma de canjearlo: el circuito de referidos no cerraba ni con los puntos
   * bien configurados. Ahora se comparte la URL de la sede con el código puesto.
   */
  const referralUrl = referralCode
    ? `${typeof window !== "undefined" ? window.location.origin : ""}/${branchSlug}/codigo?ref=${encodeURIComponent(referralCode)}`
    : "";

  const referralMessage = referralCode
    ? `Te invito a ${branchName || "mi restaurante favorito"}. Usa mi código ${referralCode} y ganamos puntos los dos: ${referralUrl}`
    : "";

  const handleCopyReferral = async () => {
    if (!referralCode) return;
    try {
      // Se copia el mensaje ENTERO con el enlace, no el código a secas: es lo
      // que la persona va a pegar en WhatsApp.
      await navigator.clipboard.writeText(referralMessage);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard may be unavailable (insecure context) — ignore.
    }
  };

  const handleShareReferral = async () => {
    if (!referralCode) return;
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({
          title: "Invita y gana",
          text: referralMessage,
          url: referralUrl,
        });
        return;
      } catch {
        // User cancelled or share unsupported — fall back to copy.
      }
    }
    handleCopyReferral();
  };

  if (loading) {
    return (
      <div className="space-y-4 p-4" aria-busy="true">
        <div className="h-8 w-40 animate-pulse rounded bg-muted" />
        <div className="h-20 animate-pulse rounded-xl bg-muted" />
        <div className="h-36 animate-pulse rounded-xl bg-muted" />
        <div className="h-28 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="space-y-4 p-6 pt-12 text-center">
        <AlertCircle className="mx-auto h-12 w-12 text-destructive" />
        <p role="alert" className="font-medium text-destructive">
          {loadError}
        </p>
        <Button
          className="h-11 w-full"
          onClick={() => {
            setLoading(true);
            void fetchAll();
          }}
        >
          <RefreshCcw className="mr-2 h-4 w-4" />
          Reintentar
        </Button>
        <Link href={`/${branchSlug}/${tableCode}/menu`} className="block">
          <Button variant="outline" className="h-11 w-full">
            Volver a la carta
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-5 pb-8">
      {/* Header */}
      <div className="flex items-center gap-2 pt-2">
        <Link href={`/${branchSlug}/${tableCode}/menu`}>
          <Button variant="ghost" className="h-10 gap-1.5 px-2">
            <ArrowLeft className="h-4 w-4" />
            Carta
          </Button>
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-xl font-bold">Mi perfil</h1>
        <Link href={`/${branchSlug}/${tableCode}/status`}>
          <Button variant="ghost" className="h-10 gap-1.5 px-2 text-xs">
            <ShoppingBag className="h-4 w-4" />
            Mis pedidos
          </Button>
        </Link>
      </div>

      {/* Customer info */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <User className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="font-semibold text-lg">{customerName || "Cliente"}</p>
              {tableNumber !== null && (
                <p className="text-sm text-muted-foreground">Mesa {tableNumber}</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Loyalty card */}
      {loyalty && (
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Star className="h-5 w-5 text-primary" />
              <p className="font-semibold text-sm">{loyalty.program_name}</p>
              {loyalty.tier_name && (
                <Badge variant="secondary" className="text-xs ml-auto">
                  {loyalty.tier_name}
                </Badge>
              )}
            </div>

            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-bold text-primary">
                {loyalty.points_balance.toLocaleString()}
              </span>
              <span className="text-sm text-muted-foreground">puntos disponibles</span>
            </div>

            {loyalty.next_tier && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Progreso a {loyalty.next_tier.name}</span>
                  <span>
                    {loyalty.total_points_earned.toLocaleString()} / {loyalty.next_tier.min_points.toLocaleString()}
                  </span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, (loyalty.total_points_earned / loyalty.next_tier.min_points) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            )}

            <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <TrendingUp className="h-3 w-3" />
              <span>Ganas puntos con cada pedido</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Invita y gana (referral) */}
      {referralCode && (
        <Card className="border-primary/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              Invita y gana
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Comparte tu código. Cuando un amigo lo use y haga su primer pedido, ambos ganan puntos.
            </p>
            <div className="flex items-center gap-2">
              <div className="flex-1 rounded-lg border border-dashed border-primary/40 bg-primary/5 px-3 py-2.5 text-center">
                <span className="font-mono text-lg font-bold tracking-widest text-primary">
                  {referralCode}
                </span>
              </div>
              <Button
                variant="outline"
                size="icon"
                className="h-10 w-10 shrink-0"
                onClick={handleCopyReferral}
                title="Copiar código"
                aria-label="Copiar código de invitación"
              >
                {copied ? (
                  <Check className="h-4 w-4 text-green-600" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
            <Button className="h-11 w-full gap-2" onClick={handleShareReferral}>
              <Share2 className="h-4 w-4" />
              {copied ? "Código copiado" : "Compartir código"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Points history */}
      {transactions.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <History className="h-4 w-4 text-primary" />
              Historial de puntos
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {transactions.map((tx) => {
              const created = tx.created_at ?? tx.createdAt ?? null;
              const expires = tx.expires_at ?? tx.expiresAt ?? null;
              const positive = tx.points >= 0;
              const showExpiry = !tx.expired && tx.type === "earned" && !!expires;
              return (
                <div
                  key={tx.id}
                  className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border bg-muted/30"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px] shrink-0">
                        {txTypeLabels[tx.type] || tx.type}
                      </Badge>
                      {tx.description && (
                        <p className="text-xs text-muted-foreground truncate">{tx.description}</p>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {created && new Date(created).toLocaleDateString("es-PE", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                      })}
                      {showExpiry && (
                        <> · Vence {new Date(expires!).toLocaleDateString("es-PE")}</>
                      )}
                      {tx.expired && <> · Expirado</>}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "text-sm font-bold shrink-0 tabular-nums",
                      positive
                        ? "text-green-600 dark:text-green-400"
                        : "text-muted-foreground",
                    )}
                  >
                    {positive ? "+" : "-"}
                    {Math.abs(tx.points).toLocaleString()} pts
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Available rewards */}
      {loyalty && loyalty.rewards.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Gift className="h-4 w-4 text-primary" />
              Recompensas disponibles
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {loyalty.rewards.map((reward) => {
              const canRedeem = loyalty.points_balance >= reward.points_cost;
              const soldOut = reward.stock_remaining != null && reward.stock_remaining <= 0;
              return (
                <div
                  key={reward.id}
                  className={cn(
                    "flex items-center justify-between gap-3 p-3 rounded-lg border",
                    canRedeem && !soldOut
                      ? "border-primary/30 bg-primary/5"
                      : "border-border bg-muted/30 opacity-60",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm truncate">{reward.name}</p>
                      <Badge variant="outline" className="text-[10px] shrink-0">
                        {rewardKindLabel(reward)}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {describeReward(reward, menuItemNames)}
                    </p>
                    {reward.description && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {reward.description}
                      </p>
                    )}
                    {soldOut && (
                      <p className="text-[11px] font-medium text-amber-600 dark:text-amber-400 mt-0.5">
                        Agotada por hoy
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 flex flex-col items-end gap-1.5">
                    <p
                      className={cn(
                        "text-xs font-bold",
                        canRedeem && !soldOut ? "text-primary" : "text-muted-foreground",
                      )}
                    >
                      {reward.points_cost.toLocaleString()} pts
                    </p>
                    {canRedeem && !soldOut ? (
                      <Button
                        className="h-10 px-4 text-sm"
                        onClick={() => handleRedeemClick(reward)}
                      >
                        Canjear
                      </Button>
                    ) : (
                      <p className="text-[10px] text-muted-foreground text-right">
                        {soldOut
                          ? "No disponible"
                          : `Faltan ${(reward.points_cost - loyalty.points_balance).toLocaleString()} pts`}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Pending redemptions */}
      {redemptions.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-600" />
              Canjes pendientes
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {redemptions.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between p-3 rounded-lg border border-green-500/20 bg-green-50 dark:bg-green-900/10"
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm">{r.reward_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {describeReward(r, menuItemNames)}
                  </p>
                </div>
                <Badge variant="secondary" className="text-[10px] bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/20 shrink-0">
                  Pendiente
                </Badge>
              </div>
            ))}
            <p className="text-[11px] text-muted-foreground text-center">
              Aplícala desde el carrito en tu próximo pedido.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Coupons */}
      {coupons.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Ticket className="h-4 w-4 text-primary" />
              Mis cupones
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {coupons.map((coupon) => (
              <div
                key={coupon.id}
                className="flex items-center justify-between p-3 rounded-lg border border-border bg-muted/30"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] font-mono shrink-0">
                      {coupon.code}
                    </Badge>
                    <p className="font-medium text-sm truncate">{coupon.name}</p>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {coupon.type === "percentage"
                      ? `${coupon.discount_value}% de descuento`
                      : `${formatCurrency(coupon.discount_value)} de descuento`}
                    {coupon.expires_at && (
                      <> · Vence {new Date(coupon.expires_at).toLocaleDateString("es-PE")}</>
                    )}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Orders */}
      {orders.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ShoppingBag className="h-4 w-4 text-primary" />
              Mis pedidos
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {orders.map((order) => (
              // El id viaja en la URL: sin él, pulsar el pedido #1 abría el
              // último pedido de la mesa y el comensal veía otro estado.
              <Link
                key={order.id}
                href={`/${branchSlug}/${tableCode}/status?orderId=${order.id}`}
                className="block"
              >
                <div className="flex min-h-12 items-center justify-between p-3 rounded-lg border border-border bg-muted/30 hover:bg-muted/50 transition-colors">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm">#{order.order_number}</p>
                      <span
                        className={cn(
                          "text-[10px] px-2 py-0.5 rounded-full font-medium border",
                          orderStatusVariants[order.status] || "bg-muted text-muted-foreground border-border",
                        )}
                      >
                        {orderStatusLabels[order.status] || order.status}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {order.items.length} {order.items.length === 1 ? "producto" : "productos"}
                    </p>
                  </div>
                  {order.total != null && (
                    <p className="font-semibold text-sm shrink-0 ml-3">
                      {formatCurrency(order.total)}
                    </p>
                  )}
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {/* No loyalty message */}
      {!loyalty && orders.length === 0 && coupons.length === 0 && transactions.length === 0 && (
        <Card>
          <CardContent className="p-6 text-center">
            <Star className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              Aún no tienes actividad. Haz tu primer pedido para empezar a acumular puntos.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Confirm redeem dialog */}
      <Dialog open={redeemDialogOpen} onOpenChange={setRedeemDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Canjear recompensa</DialogTitle>
            <DialogDescription>
              {selectedReward && loyalty && (
                <>
                  ¿Canjear <strong>{selectedReward.name}</strong> (
                  {describeReward(selectedReward, menuItemNames)}) por{" "}
                  <strong>{selectedReward.points_cost.toLocaleString()} pts</strong>?
                  <br />
                  Tu saldo quedará en{" "}
                  <strong>
                    {(loyalty.points_balance - selectedReward.points_cost).toLocaleString()} pts
                  </strong>
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              className="h-11"
              onClick={() => setRedeemDialogOpen(false)}
              disabled={redeeming}
            >
              Cancelar
            </Button>
            <Button className="h-11" onClick={handleConfirmRedeem} disabled={redeeming}>
              {redeeming ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Canjeando...
                </>
              ) : (
                "Confirmar canje"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Success dialog */}
      <Dialog open={successDialogOpen} onOpenChange={setSuccessDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-center">
              <CheckCircle className="h-12 w-12 text-green-600 mx-auto mb-3" />
              Recompensa canjeada
            </DialogTitle>
            <DialogDescription className="text-center">
              {redeemResult && (
                <>
                  <strong className="text-foreground">{redeemResult.reward.name}</strong>
                  <br />
                  {describeReward(redeemResult.reward, menuItemNames)}
                  <br />
                  <span className="text-xs">
                    Saldo actual: {redeemResult.newBalance.toLocaleString()} pts
                  </span>
                </>
              )}
              <br />
              <strong className="text-foreground text-sm mt-2 block">
                Ve al carrito para aplicarla en tu próximo pedido.
              </strong>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Link href={`/${branchSlug}/${tableCode}/cart`} className="w-full">
              <Button className="h-11 w-full">Ir al carrito</Button>
            </Link>
            <Button
              variant="outline"
              className="h-11 w-full"
              onClick={() => setSuccessDialogOpen(false)}
            >
              Seguir aquí
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
