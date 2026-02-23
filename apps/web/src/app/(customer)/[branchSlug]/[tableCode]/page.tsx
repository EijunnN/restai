"use client";
/* eslint-disable react-hooks/todo, react-hooks/set-state-in-effect, react-doctor/prefer-useReducer, react-doctor/no-giant-component */

import { use, useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
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
import { UtensilsCrossed, Star, RefreshCw } from "lucide-react";
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
    sessionId?: string;
    customerName?: string;
    token?: string;
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
    if (existingSession?.token && existingSession?.sessionId) {
      setSession({
        token: existingSession.token,
        sessionId: existingSession.sessionId,
        branchSlug,
        tableCode,
        customerName: existingSession.customerName,
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

        // If the API returned an existing active session, go directly to menu
        if (result.data.existing) {
          setSession({
            token: result.data.token,
            sessionId: result.data.sessionId,
            branchSlug,
            tableCode,
            customerName: data.customerName,
          });
          setLoading(false);
          router.push(`/${branchSlug}/${tableCode}/menu`);
          return;
        }

        setSession({
          token: result.data.token,
          sessionId: result.data.session.id,
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

  // Show reconnection option if an active session exists
  if (existingSession?.hasSession && existingSession.status === "active") {
    return (
      <div className="p-4 mt-8 space-y-4">
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10">
              <RefreshCw className="h-8 w-8 text-green-600" />
            </div>
            <CardTitle className="text-2xl">Sesion activa</CardTitle>
            <CardDescription>
              Esta mesa tiene una sesion activa de {existingSession.customerName}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button className="w-full" onClick={handleReconnect}>
              Reconectar a sesion existente
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => setExistingSession(null)}
            >
              Iniciar nueva sesion
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
              </div>
            )}

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Iniciando..." : "Ver Menu"}
            </Button>
          </CardContent>
        </form>
      </Card>
    </div>
  );
}
