"use client";
/* eslint-disable react-hooks/todo, react-hooks/set-state-in-effect, react-doctor/prefer-useReducer, react-doctor/no-giant-component */

import { use, useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { startSessionSchema, type StartSessionInput } from "@restai/validators";
import { z } from "zod";
import { Button } from "@restai/ui/components/button";
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
import Link from "next/link";
import { UtensilsCrossed, Star, RefreshCw, LogIn, Check } from "lucide-react";
import { useCustomerStore } from "@/stores/customer-store";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

const registerSchema = z.object({
  customerName: z.string().min(1, "Ingresa tu nombre").max(255),
  customerPhone: z.string().max(20).optional(),
  email: z.string().email("Email invalido").optional().or(z.literal("")),
  birthDate: z.string().optional(),
});

type RegisterInput = z.infer<typeof registerSchema>;

function useCustomerEntryLocalState() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wantsLoyalty, setWantsLoyalty] = useState(false);
  const [existingSession, setExistingSession] = useState<{
    hasSession: boolean;
    status?: string;
  } | null>(null);
  const [checkingSession, setCheckingSession] = useState(true);

  return {
    loading,
    setLoading,
    error,
    setError,
    wantsLoyalty,
    setWantsLoyalty,
    existingSession,
    setExistingSession,
    checkingSession,
    setCheckingSession,
  };
}

export default function CustomerEntryPage({
  params,
}: {
  params: Promise<{ branchSlug: string; tableCode: string }>;
}) {
  return <CustomerEntryPageContent params={params} />;
}

function CustomerEntryPageContent({
  params,
}: {
  params: Promise<{ branchSlug: string; tableCode: string }>;
}) {
  "use no memo";
  const { branchSlug, tableCode } = use(params);
  const router = useRouter();
  // Referral link support: /{branch}/{table}?ref=CODE → forwarded on register.
  const referralCode = useSearchParams().get("ref") || undefined;
  // Marketing consent (Ley 29733). Defaults on for loyalty joiners so they get
  // coupons/offers by email; clearly shown and toggleable.
  const [marketingOptIn, setMarketingOptIn] = useState(true);
  const {
    loading,
    setLoading,
    error,
    setError,
    wantsLoyalty,
    setWantsLoyalty,
    existingSession,
    setExistingSession,
    checkingSession,
    setCheckingSession,
  } = useCustomerEntryLocalState();
  const setSession = useCustomerStore((s) => s.setSession);
  // The server no longer hands an existing session's token to anyone scanning
  // the QR (that was a credential-disclosure vulnerability). A legitimate owner
  // reconnects using the token already persisted in their own browser session.
  const savedToken = useCustomerStore((s) => s.token);
  const savedSessionId = useCustomerStore((s) => s.sessionId);
  const savedBranchSlug = useCustomerStore((s) => s.branchSlug);
  const savedTableCode = useCustomerStore((s) => s.tableCode);
  const savedCustomerName = useCustomerStore((s) => s.customerName);
  const canReconnect =
    !!savedToken &&
    !!savedSessionId &&
    savedBranchSlug === branchSlug &&
    savedTableCode === tableCode;

  const checkExistingSession = useCallback(() => {
    setCheckingSession(true);
    void fetch(`${API_URL}/api/customer/${branchSlug}/${tableCode}/check-session`)
      .then((res) => res.json())
      .then((result) => {
        if (result.success && result.data.hasSession) {
          setExistingSession(result.data);
        } else {
          setExistingSession(null);
        }
      })
      .catch(() => {
        // Ignore - proceed with normal flow
        setExistingSession(null);
      })
      .finally(() => {
        setCheckingSession(false);
      });
  }, [branchSlug, tableCode, setCheckingSession, setExistingSession]);

  // Check for existing active/pending session on this table
  useEffect(() => {
    const timeout = setTimeout(() => {
      checkExistingSession();
    }, 0);
    return () => clearTimeout(timeout);
  }, [checkExistingSession]);

  const handleReconnect = () => {
    if (canReconnect && savedToken && savedSessionId) {
      setSession({
        token: savedToken,
        sessionId: savedSessionId,
        branchSlug,
        tableCode,
        customerName: savedCustomerName ?? undefined,
      });
      router.push(`/${branchSlug}/${tableCode}/menu`);
    }
  };

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<RegisterInput>({
    resolver: zodResolver(wantsLoyalty ? registerSchema : startSessionSchema),
  });

  const onSubmit = (data: RegisterInput) => {
    setLoading(true);
    setError(null);

    const endpoint = wantsLoyalty
      ? `${API_URL}/api/customer/${branchSlug}/${tableCode}/register`
      : `${API_URL}/api/customer/${branchSlug}/${tableCode}/session`;

    const body = wantsLoyalty
      ? {
          customerName: data.customerName,
          customerPhone: data.customerPhone || undefined,
          email: data.email || undefined,
          birthDate: data.birthDate || undefined,
          marketingOptIn: data.email ? marketingOptIn : false,
          referralCode,
        }
      : {
          customerName: data.customerName,
          customerPhone: data.customerPhone || undefined,
        };

    void fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((res) => res.json())
      .then((result) => {
        if (!result.success) {
          if (result.error?.code === "SESSION_PENDING") {
            setExistingSession({ hasSession: true, status: "pending" });
            setLoading(false);
            return;
          }
          setError(result.error?.message || "Error al iniciar sesion");
          setLoading(false);
          return;
        }

        // If the table got an active session between our check and this submit,
        // the server returns { status: "active" } WITHOUT a token (it never
        // discloses another customer's credential). Surface the occupied state.
        if (result.data.status === "active" || !result.data.token) {
          setExistingSession({ hasSession: true, status: "active" });
          setLoading(false);
          return;
        }

        setSession({
          token: result.data.token,
          sessionId: result.data.sessionId ?? result.data.session?.id,
          branchSlug,
          tableCode,
          customerName: data.customerName,
        });
        setLoading(false);
        router.push(`/${branchSlug}/${tableCode}/waiting`);
      })
      .catch(() => {
        setError("Error inesperado");
        setLoading(false);
      });
  };

  if (checkingSession) {
    return (
      <div className="p-4 mt-8 flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Verificando mesa...</div>
      </div>
    );
  }

  // An active session exists on this table. Only the owner (whose token is
  // saved in this browser) may continue it; anyone else just sees it occupied.
  if (existingSession?.hasSession && existingSession.status === "active") {
    return (
      <div className="p-4 mt-8 space-y-4">
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10">
              <RefreshCw className="h-8 w-8 text-green-600" />
            </div>
            <CardTitle className="text-2xl">
              {canReconnect ? "Sesion activa" : "Mesa ocupada"}
            </CardTitle>
            <CardDescription>
              {canReconnect
                ? "Tienes una sesion activa en esta mesa."
                : "Esta mesa ya tiene una sesion activa. Si crees que es un error, pide ayuda al personal."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {canReconnect && (
              <Button className="w-full" onClick={handleReconnect}>
                Continuar mi sesion
              </Button>
            )}
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setExistingSession(null);
                setCheckingSession(true);
                void checkExistingSession();
              }}
            >
              Verificar de nuevo
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Show pending message
  if (existingSession?.hasSession && existingSession.status === "pending") {
    return (
      <div className="p-4 mt-8">
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/10">
              <UtensilsCrossed className="h-8 w-8 text-amber-600" />
            </div>
            <CardTitle className="text-2xl">Mesa en espera</CardTitle>
            <CardDescription>
              Esta mesa esta esperando aprobacion del personal. Intenta de nuevo en unos momentos.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => {
                setExistingSession(null);
                setCheckingSession(true);
                void checkExistingSession();
              }}
            >
              Verificar de nuevo
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 mt-8">
      <Card>
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <UtensilsCrossed className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-2xl">Bienvenido</CardTitle>
          <CardDescription>
            Mesa {tableCode} - Ingresa tus datos para empezar a ordenar
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit(onSubmit)}>
          <CardContent className="space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="customerName">Tu nombre *</Label>
              <Input
                id="customerName"
                placeholder="Ingresa tu nombre"
                {...register("customerName")}
              />
              {errors.customerName && (
                <p className="text-sm text-destructive">
                  {errors.customerName.message}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="customerPhone">Telefono (opcional)</Label>
              <Input
                id="customerPhone"
                placeholder="987 654 321"
                {...register("customerPhone")}
              />
              {errors.customerPhone && (
                <p className="text-sm text-destructive">
                  {errors.customerPhone.message}
                </p>
              )}
            </div>

            {/* Loyalty opt-in */}
            <button
              type="button"
              aria-pressed={wantsLoyalty}
              className={`w-full rounded-lg border p-4 cursor-pointer text-left transition-colors ${
                wantsLoyalty
                  ? "border-primary bg-primary/5"
                  : "border-border bg-muted/30 hover:bg-muted/50"
              }`}
              onClick={() => setWantsLoyalty(!wantsLoyalty)}
            >
              <div className="flex items-center gap-3">
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                  wantsLoyalty ? "bg-primary/20" : "bg-muted"
                }`}>
                  <Star className={`h-4 w-4 ${wantsLoyalty ? "text-primary" : "text-muted-foreground"}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    Quieres acumular puntos?
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Registrate y gana puntos con cada pedido
                  </p>
                </div>
                <div className={`h-5 w-9 rounded-full transition-colors relative ${
                  wantsLoyalty ? "bg-primary" : "bg-muted-foreground/30"
                }`}>
                  <div className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                    wantsLoyalty ? "translate-x-4" : "translate-x-0.5"
                  }`} />
                </div>
              </div>
            </button>

            {wantsLoyalty && (
              <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="tu@email.com"
                    {...register("email")}
                  />
                  {errors.email && (
                    <p className="text-sm text-destructive">
                      {errors.email.message}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="birthDate">Fecha de nacimiento (opcional)</Label>
                  <Controller
                    control={control}
                    name="birthDate"
                    render={({ field }) => (
                      <DatePicker
                        id="birthDate"
                        value={field.value}
                        onChange={(d) => field.onChange(d ?? "")}
                      />
                    )}
                  />
                </div>

                {/* Marketing consent (Ley 29733): controls coupon/offer emails. */}
                <button
                  type="button"
                  aria-pressed={marketingOptIn}
                  onClick={() => setMarketingOptIn((v) => !v)}
                  className="flex w-full items-start gap-3 rounded-lg border border-border bg-muted/20 p-3 text-left"
                >
                  <span
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors ${
                      marketingOptIn
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-muted-foreground/40"
                    }`}
                  >
                    {marketingOptIn && <Check className="h-3.5 w-3.5" />}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Quiero recibir <span className="font-medium text-foreground">cupones y novedades</span> por correo.
                    Necesitas tu email para iniciar sesión y recibir tus recompensas.
                  </span>
                </button>
              </div>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Iniciando..." : "Empezar a ordenar"}
            </Button>

            {/* Existing members: log in with an email code to see points/rewards. */}
            <div className="flex items-center gap-3 pt-1">
              <div className="h-px flex-1 bg-border" />
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                ¿Ya eres miembro?
              </span>
              <div className="h-px flex-1 bg-border" />
            </div>
            <Link
              href={`/${branchSlug}/${tableCode}/login`}
              className="flex w-full items-center justify-center gap-2 rounded-md border border-border bg-background py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
            >
              <LogIn className="h-4 w-4" />
              Iniciar sesión con mi correo
            </Link>
          </CardContent>
        </form>
      </Card>
    </div>
  );
}
