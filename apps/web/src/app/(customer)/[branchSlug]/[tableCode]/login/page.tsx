"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
import { Mail, KeyRound, ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useCustomerStore } from "@/stores/customer-store";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export default function CustomerLoginPage({
  params,
}: {
  params: Promise<{ branchSlug: string; tableCode: string }>;
}) {
  "use no memo";
  const { branchSlug, tableCode } = use(params);
  const router = useRouter();
  const setSession = useCustomerStore((s) => s.setSession);

  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestCode = async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      setError("Ingresa tu correo");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_URL}/api/customer/${branchSlug}/login/request-code`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: trimmed }),
        },
      );
      const result = await res.json();
      if (!res.ok || !result.success) {
        throw new Error(result.error?.message || "No se pudo enviar el código");
      }
      // The API responds generically (it never reveals whether the email exists),
      // so we always move to the code step.
      setStep("code");
      toast.success("Si tu correo está registrado, te enviamos un código.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado");
    } finally {
      setLoading(false);
    }
  };

  const verifyCode = async () => {
    const trimmedCode = code.trim();
    if (!/^\d{6}$/.test(trimmedCode)) {
      setError("El código tiene 6 dígitos");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_URL}/api/customer/${branchSlug}/login/verify-code`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim(), code: trimmedCode, tableCode }),
        },
      );
      const result = await res.json();
      if (!res.ok || !result.success) {
        if (result.error?.code === "SESSION_PENDING") {
          setError("Esta mesa ya está esperando aprobación del personal.");
          return;
        }
        throw new Error(result.error?.message || "Código inválido o expirado");
      }

      // The table already has an active session → no token issued.
      if (result.data.status === "active" || !result.data.token) {
        setError("Esta mesa ya está ocupada. Pide ayuda al personal.");
        return;
      }

      // Verified + pending session created → wait for the waiter to approve.
      setSession({
        token: result.data.token,
        sessionId: result.data.sessionId ?? result.data.session?.id,
        branchSlug,
        tableCode,
        customerName: result.data.customer?.name,
      });
      toast.success(`Hola ${result.data.customer?.name || ""}, solicitamos tu ingreso`);
      router.push(`/${branchSlug}/${tableCode}/waiting`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 mt-8">
      <Card>
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            {step === "email" ? (
              <Mail className="h-8 w-8 text-primary" />
            ) : (
              <KeyRound className="h-8 w-8 text-primary" />
            )}
          </div>
          <CardTitle className="text-2xl">Iniciar sesión</CardTitle>
          <CardDescription>
            {step === "email"
              ? "Ingresa tu correo y te enviaremos un código de acceso."
              : `Ingresa el código de 6 dígitos que enviamos a ${email}.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {step === "email" ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="login-email">Correo electrónico</Label>
                <Input
                  id="login-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="tu@email.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setError(null);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && requestCode()}
                />
              </div>
              <Button className="w-full" onClick={requestCode} disabled={loading}>
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Enviar código"
                )}
              </Button>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="login-code">Código</Label>
                <Input
                  id="login-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  placeholder="123456"
                  className="text-center text-2xl font-mono tracking-[0.5em]"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                    setError(null);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && verifyCode()}
                />
              </div>
              <Button className="w-full" onClick={verifyCode} disabled={loading}>
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Verificar e ingresar"
                )}
              </Button>
              <button
                type="button"
                className="w-full text-sm text-muted-foreground hover:text-foreground"
                onClick={() => {
                  setStep("email");
                  setCode("");
                  setError(null);
                }}
              >
                Usar otro correo
              </button>
            </>
          )}

          <Link
            href={`/${branchSlug}/${tableCode}`}
            className="flex items-center justify-center gap-1 text-sm text-muted-foreground hover:text-foreground pt-2"
          >
            <ArrowLeft className="h-4 w-4" />
            Volver
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
