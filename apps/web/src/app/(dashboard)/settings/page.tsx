"use client";

import { useState } from "react";
import { Button } from "@restai/ui/components/button";
import { RefreshCw, Building2, MapPin, Store } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { useOrgSettings, useBranchSettings } from "@/hooks/use-settings";
import { OrgTab } from "./_components/org-tab";
import { BranchTab } from "./_components/branch-tab";
import { SedesTab } from "./_components/sedes-tab";

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<"org" | "branch" | "sedes">("org");

  const { error: orgError, refetch: refetchOrg } = useOrgSettings();
  const { error: branchError, refetch: refetchBranch } = useBranchSettings();

  const error = orgError || branchError;
  if (error) {
    return (
      <div className="space-y-6 max-w-2xl">
        <PageHeader title="Configuracion" />
        <div className="p-4 rounded-lg border border-destructive/50 bg-destructive/5 flex items-center justify-between">
          <p className="text-sm text-destructive">Error al cargar: {(error as Error).message}</p>
          <Button variant="outline" size="sm" onClick={() => { refetchOrg(); refetchBranch(); }}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Reintentar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader
        title="Configuracion"
        description="Administra la configuracion de tu organizacion y sedes"
      />

      <div className="flex gap-2 border-b pb-2">
        <Button
          variant={activeTab === "org" ? "default" : "ghost"}
          size="sm"
          onClick={() => setActiveTab("org")}
        >
          <Building2 className="h-4 w-4 mr-2" />
          Organizacion
        </Button>
        <Button
          variant={activeTab === "branch" ? "default" : "ghost"}
          size="sm"
          onClick={() => setActiveTab("branch")}
        >
          <MapPin className="h-4 w-4 mr-2" />
          Sede
        </Button>
        <Button
          variant={activeTab === "sedes" ? "default" : "ghost"}
          size="sm"
          onClick={() => setActiveTab("sedes")}
        >
          <Store className="h-4 w-4 mr-2" />
          Sedes
        </Button>
      </div>

      {activeTab === "org" && <OrgTab />}
      {activeTab === "branch" && <BranchTab />}
      {activeTab === "sedes" && <SedesTab />}
    </div>
  );
}
