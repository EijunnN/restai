"use client";

import { use, useEffect, useState } from "react";
import { UtensilsCrossed } from "lucide-react";
import {
  CartaLectura,
  type CategoriaCarta,
  type PlatoCarta,
} from "@/components/customer/carta-lectura";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

/**
 * La carta de una sede, sin mesa.
 *
 * Es el QR que se pega en la puerta o en la carta plastificada: enseña lo que
 * hay y punto. No abre sesión, no pide nombre y no permite pedir, así que puede
 * ser pública en cualquier modo de carta.
 *
 * Se resuelve por el CÓDIGO de la sede y no por su slug. El slug solo es único
 * dentro de su organización: dos cadenas pueden tener cada una su "miraflores",
 * y resolver por ahí acabaría sirviendo la carta del restaurante equivocado. El
 * slug se queda en la URL porque es lo que hace legible el enlace impreso.
 */
export default function CartaDeSedePage({
  params,
}: {
  params: Promise<{ branchSlug: string; codigo: string }>;
}) {
  const { codigo } = use(params);

  const [datos, setDatos] = useState<{
    branch: { name: string; currency?: string };
    categories: CategoriaCarta[];
    items: PlatoCarta[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let vivo = true;

    void fetch(`${API_URL}/api/customer/carta/${encodeURIComponent(codigo)}`)
      .then((r) => r.json())
      .then((res) => {
        if (!vivo) return;
        if (!res.success) {
          setError(res.error?.message || "No encontramos esta carta.");
        } else {
          setDatos(res.data);
        }
        setCargando(false);
      })
      .catch(() => {
        if (!vivo) return;
        setError("No hay conexión. Revisa tu red e inténtalo de nuevo.");
        setCargando(false);
      });

    return () => {
      vivo = false;
    };
  }, [codigo]);

  if (cargando) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <p className="text-sm text-muted-foreground">Cargando la carta…</p>
      </div>
    );
  }

  if (error || !datos) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <UtensilsCrossed className="h-8 w-8 text-muted-foreground/40" aria-hidden="true" />
        <p className="text-[15px] font-medium">{error ?? "No encontramos esta carta."}</p>
        <p className="text-[13px] text-muted-foreground">
          Comprueba el código del cartel o pídeselo al personal.
        </p>
      </div>
    );
  }

  return (
    <CartaLectura
      branchName={datos.branch.name}
      currency={datos.branch.currency}
      categories={datos.categories}
      items={datos.items}
      comoPedir="Cuando quieras pedir, llama a un mozo."
    />
  );
}
