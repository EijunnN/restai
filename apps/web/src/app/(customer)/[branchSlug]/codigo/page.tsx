"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@restai/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@restai/ui/components/card";
import { Input } from "@restai/ui/components/input";
import { Label } from "@restai/ui/components/label";
import { KeyRound, Loader2, AlertCircle } from "lucide-react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

/**
 * Entrada por código de mesa: el plan B cuando el QR no es una opción.
 *
 * Hasta ahora no había ninguno. Un comensal sin cámara, sin datos, con el
 * sticker despegado, o simplemente alguien mayor que no usa QR, dejaba a esa
 * mesa fuera del sistema: volvía al papel y el local perdía la estandarización
 * que está comprando.
 *
 * El cartel de la mesa imprime este enlace y el código corto (ver el diálogo de
 * QR del panel), así que el comensal solo teclea 5 caracteres de un alfabeto sin
 * caracteres ambiguos.
 */
export default function TableCodeEntryPage({
  params,
}: {
  params: Promise<{ branchSlug: string }>;
}) {
  const { branchSlug } = use(params);
  const router = useRouter();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalized = code.trim().toUpperCase().replace(/[\s\-_.]/g, "");
  const canSubmit = normalized.length >= 4 && !loading;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setLoading(true);
    setError(null);

    void fetch(
      `${API_URL}/api/customer/${encodeURIComponent(branchSlug)}/tables/by-code/${encodeURIComponent(normalized)}`,
    )
      .then((res) => res.json())
      .then((result) => {
        const qrCode = result?.data?.table?.qr_code;
        if (!result.success || !qrCode) {
          setError(
            result.error?.message ??
              "No encontramos esa mesa. Revisa el código con el personal.",
          );
          setLoading(false);
          return;
        }
        // A partir de aquí el flujo es idéntico al del QR: se entra por la misma
        // pantalla, con la misma resolución de sesión.
        router.replace(`/${branchSlug}/${qrCode}`);
      })
      .catch(() => {
        setError("No pudimos conectar. Revisa tu conexión e inténtalo de nuevo.");
        setLoading(false);
      });
  };

  return (
    <div className="p-4 mt-8">
      <Card>
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
            <KeyRound className="h-8 w-8 text-primary" />
          </div>
          <CardTitle className="text-2xl">Ingresa el código de tu mesa</CardTitle>
          <CardDescription>
            Lo encuentras en el cartel de la mesa, debajo del código QR.
          </CardDescription>
        </CardHeader>
        <form onSubmit={onSubmit}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="table-code">Código de mesa</Label>
              <Input
                id="table-code"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="Ej. NXNV2"
                // `characters` evita el autocorrector del móvil, que "arregla"
                // el código y lo vuelve inservible.
                autoCapitalize="characters"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                inputMode="text"
                maxLength={8}
                autoFocus
                aria-describedby={error ? "table-code-error" : undefined}
                aria-invalid={!!error}
                className="h-14 text-center text-2xl font-bold tracking-[0.4em] uppercase"
              />
            </div>

            {error && (
              <div
                id="table-code-error"
                role="alert"
                className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button type="submit" className="h-12 w-full text-base" disabled={!canSubmit}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Buscando tu mesa...
                </>
              ) : (
                "Continuar"
              )}
            </Button>

            <p className="text-center text-xs text-muted-foreground">
              ¿No ves el código? Pídeselo al personal y te sentamos en un momento.
            </p>
          </CardContent>
        </form>
      </Card>
    </div>
  );
}
