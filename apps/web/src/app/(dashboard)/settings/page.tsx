"use client";

import { useEffect, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@restai/ui/components/card";
import { Input } from "@restai/ui/components/input";
import { Label } from "@restai/ui/components/label";
import { Button } from "@restai/ui/components/button";
import { Select } from "@restai/ui/components/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@restai/ui/components/dialog";
import { RefreshCw, Building2, MapPin, Upload, Plus, Pencil, Store } from "lucide-react";
import { useOrgSettings, useBranchSettings, useUpdateOrg, useUpdateBranch, useBranches, useCreateBranch, useUpdateBranchById } from "@/hooks/use-settings";
import { useUploadImage } from "@/hooks/use-uploads";
import { toast } from "sonner";

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-muted rounded ${className ?? ""}`} />;
}

const TIMEZONES = [
  "America/Lima",
  "America/Bogota",
  "America/Mexico_City",
  "America/Buenos_Aires",
  "America/Santiago",
  "America/Sao_Paulo",
  "America/New_York",
];

function slugify(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<"org" | "branch" | "sedes">("org");

  const { data: orgData, isLoading: orgLoading, error: orgError, refetch: refetchOrg } = useOrgSettings();
  const { data: branchData, isLoading: branchLoading, error: branchError, refetch: refetchBranch } = useBranchSettings();
  const { data: branches, isLoading: branchesLoading } = useBranches();
  const updateOrg = useUpdateOrg();
  const updateBranch = useUpdateBranch();
  const createBranch = useCreateBranch();
  const updateBranchById = useUpdateBranchById();
  const uploadImage = useUploadImage();
  const logoFileRef = useRef<HTMLInputElement>(null);

  const [orgForm, setOrgForm] = useState({ name: "", logoUrl: "" });
  const [branchForm, setBranchForm] = useState({
    name: "",
    address: "",
    phone: "",
    taxRate: "18.00",
    timezone: "America/Lima",
    currency: "PEN",
  });

  // Branch dialog state
  const [branchDialogOpen, setBranchDialogOpen] = useState(false);
  const [editingBranch, setEditingBranch] = useState<any>(null);
  const [branchDialogForm, setBranchDialogForm] = useState({
    name: "",
    slug: "",
    address: "",
    phone: "",
  });
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);

  // Sync org data to form
  useEffect(() => {
    if (orgData) {
      setOrgForm({
        name: orgData.name || "",
        logoUrl: orgData.logo_url || "",
      });
    }
  }, [orgData]);

  // Sync branch data to form
  useEffect(() => {
    if (branchData) {
      setBranchForm({
        name: branchData.name || "",
        address: branchData.address || "",
        phone: branchData.phone || "",
        taxRate: ((branchData.tax_rate || 1800) / 100).toFixed(2),
        timezone: branchData.timezone || "America/Lima",
        currency: branchData.currency || "PEN",
      });
    }
  }, [branchData]);

  const handleOrgSave = async () => {
    try {
      await updateOrg.mutateAsync({
        name: orgForm.name,
        logoUrl: orgForm.logoUrl || null,
      });
      toast.success("Organizacion actualizada correctamente");
    } catch (err: any) {
      toast.error(err.message || "Error al actualizar organizacion");
    }
  };

  const handleBranchSave = async () => {
    try {
      const taxRateNum = Math.round(parseFloat(branchForm.taxRate) * 100);
      await updateBranch.mutateAsync({
        name: branchForm.name,
        address: branchForm.address,
        phone: branchForm.phone,
        taxRate: taxRateNum,
        timezone: branchForm.timezone,
        currency: branchForm.currency,
      });
      toast.success("Sede actualizada correctamente");
    } catch (err: any) {
      toast.error(err.message || "Error al actualizar sede");
    }
  };

  const openCreateBranchDialog = () => {
    setEditingBranch(null);
    setBranchDialogForm({ name: "", slug: "", address: "", phone: "" });
    setSlugManuallyEdited(false);
    setBranchDialogOpen(true);
  };

  const openEditBranchDialog = (branch: any) => {
    setEditingBranch(branch);
    setBranchDialogForm({
      name: branch.name || "",
      slug: branch.slug || "",
      address: branch.address || "",
      phone: branch.phone || "",
    });
    setSlugManuallyEdited(true);
    setBranchDialogOpen(true);
  };

  const handleBranchDialogSave = async () => {
    try {
      if (editingBranch) {
        await updateBranchById.mutateAsync({
          id: editingBranch.id,
          name: branchDialogForm.name,
          slug: branchDialogForm.slug,
          address: branchDialogForm.address,
          phone: branchDialogForm.phone,
        });
        toast.success("Sede actualizada correctamente");
      } else {
        await createBranch.mutateAsync({
          name: branchDialogForm.name,
          slug: branchDialogForm.slug,
          address: branchDialogForm.address || undefined,
          phone: branchDialogForm.phone || undefined,
        });
        toast.success("Sede creada correctamente");
      }
      setBranchDialogOpen(false);
    } catch (err: any) {
      toast.error(err.message || "Error al guardar sede");
    }
  };

  const error = orgError || branchError;
  if (error) {
    return (
      <div className="space-y-6 max-w-2xl">
        <div>
          <h1 className="text-2xl font-bold">Configuracion</h1>
        </div>
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
      <div>
        <h1 className="text-2xl font-bold">Configuracion</h1>
        <p className="text-muted-foreground">
          Administra la configuracion de tu organizacion y sedes
        </p>
      </div>

      {/* Tab buttons */}
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

      {activeTab === "org" && (
        <Card>
          <CardHeader>
            <CardTitle>Organizacion</CardTitle>
            <CardDescription>
              Configuracion general de tu restaurante
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {orgLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="orgName">Nombre</Label>
                  <Input
                    id="orgName"
                    value={orgForm.name}
                    onChange={(e) => setOrgForm({ ...orgForm, name: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Logo</Label>
                  <div className="flex items-center gap-4">
                    {orgForm.logoUrl && (
                      <img
                        src={orgForm.logoUrl}
                        alt="Logo"
                        className="h-16 w-16 rounded-lg object-cover border"
                      />
                    )}
                    <div className="flex flex-col gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => logoFileRef.current?.click()}
                        disabled={uploadImage.isPending}
                      >
                        <Upload className="h-4 w-4 mr-2" />
                        {uploadImage.isPending ? "Subiendo..." : orgForm.logoUrl ? "Cambiar Logo" : "Subir Logo"}
                      </Button>
                      <p className="text-xs text-muted-foreground">
                        JPEG, PNG, WebP o GIF. Max 5MB
                      </p>
                    </div>
                    <input
                      ref={logoFileRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        try {
                          const result = await uploadImage.mutateAsync({ file, type: "logo" });
                          setOrgForm({ ...orgForm, logoUrl: result.url });
                          toast.success("Logo subido correctamente");
                        } catch (err: any) {
                          toast.error(err.message || "Error al subir logo");
                        }
                        if (logoFileRef.current) logoFileRef.current.value = "";
                      }}
                    />
                  </div>
                </div>
                <Button onClick={handleOrgSave} disabled={updateOrg.isPending}>
                  {updateOrg.isPending ? "Guardando..." : "Guardar Cambios"}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === "branch" && (
        <Card>
          <CardHeader>
            <CardTitle>Sede Actual</CardTitle>
            <CardDescription>
              Configuracion de la sede seleccionada
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {branchLoading ? (
              <div className="space-y-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="branchName">Nombre de la Sede</Label>
                    <Input
                      id="branchName"
                      value={branchForm.name}
                      onChange={(e) => setBranchForm({ ...branchForm, name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="branchPhone">Telefono</Label>
                    <Input
                      id="branchPhone"
                      value={branchForm.phone}
                      onChange={(e) => setBranchForm({ ...branchForm, phone: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="branchAddress">Direccion</Label>
                  <Input
                    id="branchAddress"
                    value={branchForm.address}
                    onChange={(e) => setBranchForm({ ...branchForm, address: e.target.value })}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="branchTimezone">Zona Horaria</Label>
                    <Select
                      id="branchTimezone"
                      value={branchForm.timezone}
                      onChange={(e) => setBranchForm({ ...branchForm, timezone: e.target.value })}
                    >
                      {TIMEZONES.map((tz) => (
                        <option key={tz} value={tz}>{tz}</option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="branchCurrency">Moneda</Label>
                    <Select
                      id="branchCurrency"
                      value={branchForm.currency}
                      onChange={(e) => setBranchForm({ ...branchForm, currency: e.target.value })}
                    >
                      <option value="PEN">PEN (Soles)</option>
                      <option value="USD">USD (Dolares)</option>
                      <option value="EUR">EUR (Euros)</option>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="branchTaxRate">IGV (%)</Label>
                  <Input
                    id="branchTaxRate"
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    value={branchForm.taxRate}
                    onChange={(e) => setBranchForm({ ...branchForm, taxRate: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    Ingresa el porcentaje (ej: 18.00 para 18%)
                  </p>
                </div>
                <Button onClick={handleBranchSave} disabled={updateBranch.isPending}>
                  {updateBranch.isPending ? "Guardando..." : "Guardar Cambios"}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === "sedes" && (
        <>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold">Todas las Sedes</h2>
              <p className="text-sm text-muted-foreground">Gestiona las sedes de tu organizacion</p>
            </div>
            <Button size="sm" onClick={openCreateBranchDialog}>
              <Plus className="h-4 w-4 mr-2" />
              Nueva Sede
            </Button>
          </div>

          {branchesLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : !branches || branches.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Store className="h-12 w-12 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No hay sedes configuradas</p>
                <Button className="mt-4" size="sm" onClick={openCreateBranchDialog}>
                  <Plus className="h-4 w-4 mr-2" />
                  Crear primera sede
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {branches.map((branch: any) => (
                <Card key={branch.id}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="flex items-center justify-center h-10 w-10 rounded-full bg-primary/10 text-primary border border-primary/20">
                          <Store className="h-5 w-5" />
                        </div>
                        <div>
                          <p className="font-medium">{branch.name}</p>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">{branch.slug}</span>
                            {branch.address && <span>· {branch.address}</span>}
                            {branch.phone && <span>· {branch.phone}</span>}
                          </div>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEditBranchDialog(branch)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          <Dialog open={branchDialogOpen} onOpenChange={setBranchDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{editingBranch ? "Editar Sede" : "Nueva Sede"}</DialogTitle>
                <DialogDescription>
                  {editingBranch ? "Modifica los datos de la sede" : "Agrega una nueva sede a tu organizacion"}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label htmlFor="dialogBranchName">Nombre</Label>
                  <Input
                    id="dialogBranchName"
                    placeholder="Sede Centro"
                    value={branchDialogForm.name}
                    onChange={(e) => {
                      const name = e.target.value;
                      setBranchDialogForm({
                        ...branchDialogForm,
                        name,
                        slug: slugManuallyEdited ? branchDialogForm.slug : slugify(name),
                      });
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dialogBranchSlug">Slug (URL)</Label>
                  <Input
                    id="dialogBranchSlug"
                    placeholder="sede-centro"
                    value={branchDialogForm.slug}
                    onChange={(e) => {
                      setSlugManuallyEdited(true);
                      setBranchDialogForm({ ...branchDialogForm, slug: e.target.value });
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    Identificador unico para URLs y codigos QR
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dialogBranchAddress">Direccion</Label>
                  <Input
                    id="dialogBranchAddress"
                    placeholder="Av. Principal 123"
                    value={branchDialogForm.address}
                    onChange={(e) => setBranchDialogForm({ ...branchDialogForm, address: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dialogBranchPhone">Telefono</Label>
                  <Input
                    id="dialogBranchPhone"
                    placeholder="+51 999 999 999"
                    value={branchDialogForm.phone}
                    onChange={(e) => setBranchDialogForm({ ...branchDialogForm, phone: e.target.value })}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setBranchDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button
                  onClick={handleBranchDialogSave}
                  disabled={!branchDialogForm.name || !branchDialogForm.slug || createBranch.isPending || updateBranchById.isPending}
                >
                  {(createBranch.isPending || updateBranchById.isPending) ? "Guardando..." : editingBranch ? "Guardar" : "Crear Sede"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
