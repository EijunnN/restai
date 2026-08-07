"use client";

import { useState } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@restai/ui/components/tabs";
import { Building2, MapPin, Store, ReceiptText } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { useAuthStore } from "@/stores/auth-store";
import { hasPermission } from "@/lib/permissions";
import { useSunatConfig } from "@/hooks/use-settings";
import { OrgTab } from "./_components/org-tab";
import { BranchTab } from "./_components/branch-tab";
import { SedesTab } from "./_components/sedes-tab";
import { SunatTab } from "./_components/sunat-tab";

type TabId = "org" | "branch" | "sedes" | "sunat";

export default function SettingsPage() {
  const role = useAuthStore((s) => s.user?.role);
  const [activeTab, setActiveTab] = useState<TabId>("org");

  const puedeVerSunat = hasPermission(role, "sunat:read");
  const puedeEditarSunat = hasPermission(role, "sunat:*");
  const puedeEditarOrg = hasPermission(role, "org:update");
  const puedeEditarSede = hasPermission(role, "branch:update");
  const puedeCrearSedes = hasPermission(role, "branch:create");

  // Se consulta también fuera de la pestaña para poder señalarla cuando la
  // facturación no está lista: el dueño no puede descubrirlo el día que un
  // cliente le pide factura.
  const { data: sunatConfig } = useSunatConfig(puedeVerSunat);
  const sunatIncompleta =
    puedeVerSunat && !!sunatConfig && (!sunatConfig.configurado || !sunatConfig.enabled);

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader
        title="Configuración"
        description="Datos del negocio, ajustes de cada sede y facturación electrónica."
      />

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabId)}>
        <TabsList className="h-auto flex-wrap justify-start gap-1">
          <TabsTrigger value="org" className="h-10">
            <Building2 className="h-4 w-4 mr-2" />
            Organización
          </TabsTrigger>
          <TabsTrigger value="branch" className="h-10">
            <MapPin className="h-4 w-4 mr-2" />
            Sede
          </TabsTrigger>
          <TabsTrigger value="sedes" className="h-10">
            <Store className="h-4 w-4 mr-2" />
            Sedes
          </TabsTrigger>
          {puedeVerSunat && (
            <TabsTrigger value="sunat" className="h-10">
              <ReceiptText className="h-4 w-4 mr-2" />
              Facturación electrónica
              {sunatIncompleta && (
                <span
                  role="img"
                  aria-label="Requiere atención"
                  className="ml-2 inline-block h-2 w-2 rounded-full bg-amber-500"
                />
              )}
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="org" className="mt-4">
          <OrgTab canWrite={puedeEditarOrg} />
        </TabsContent>
        <TabsContent value="branch" className="mt-4">
          <BranchTab canWrite={puedeEditarSede} />
        </TabsContent>
        <TabsContent value="sedes" className="mt-4">
          <SedesTab canCreate={puedeCrearSedes} canEdit={puedeEditarSede} />
        </TabsContent>
        {puedeVerSunat && (
          <TabsContent value="sunat" className="mt-4">
            <SunatTab canWrite={puedeEditarSunat} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
