"use client";

import { use, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@restai/ui/components/card";
import { Button } from "@restai/ui/components/button";
import { Loader2, Clock, CheckCircle2, XCircle } from "lucide-react";
import { useCustomerStore } from "@/stores/customer-store";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export default function WaitingPage({
  params,
}: {
  params: Promise<{ branchSlug: string; tableCode: string }>;
}) {
  const { branchSlug, tableCode } = use(params);
  const router = useRouter();
  const sessionId = useCustomerStore((s) => s.sessionId);
  const [status, setStatus] = useState<"pending" | "active" | "rejected">("pending");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;

    const poll = async () => {
      try {
        const res = await fetch(
          `${API_URL}/api/customer/${branchSlug}/${tableCode}/session-status/${sessionId}`,
        );
        const result = await res.json();
        if (result.success) {
          setStatus(result.data.status);
          if (result.data.status === "active") {
            router.push(`/${branchSlug}/${tableCode}/menu`);
          }
        }
      } catch {
        setError("Error al verificar el estado");
      }
    };

    poll();
    const interval = setInterval(poll, 3000);
    return () => clearInterval(interval);
  }, [sessionId, branchSlug, tableCode, router]);

  if (!sessionId) {
    return (
      <div className="p-4 mt-8 text-center">
        <p className="text-muted-foreground mb-4">No se encontro la sesion</p>
        <Button variant="outline" onClick={() => router.push(`/${branchSlug}/${tableCode}`)}>
          Volver al inicio
        </Button>
      </div>
    );
  }

  if (status === "rejected") {
    return (
      <div className="p-4 mt-8">
        <Card>
          <CardContent className="py-12 text-center">
            <XCircle className="h-16 w-16 text-destructive mx-auto mb-4" />
            <h2 className="text-xl font-bold mb-2">Solicitud rechazada</h2>
            <p className="text-muted-foreground mb-6">
              Tu solicitud para ordenar fue rechazada. Consulta con el personal del restaurante.
            </p>
            <Button onClick={() => router.push(`/${branchSlug}/${tableCode}`)}>
              Intentar de nuevo
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 mt-8">
      <Card>
        <CardContent className="py-12 text-center">
          <div className="relative mx-auto mb-6 w-20 h-20">
            <Clock className="h-20 w-20 text-primary/20" />
            <Loader2 className="h-10 w-10 text-primary animate-spin absolute top-5 left-5" />
          </div>
          <h2 className="text-xl font-bold mb-2">Esperando confirmacion</h2>
          <p className="text-muted-foreground mb-2">
            Un mozo confirmara tu mesa en breve...
          </p>
          <p className="text-xs text-muted-foreground">
            Mesa {tableCode}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
