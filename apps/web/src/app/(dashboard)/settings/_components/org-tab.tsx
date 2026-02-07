"use client";

import { useEffect, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@restai/ui/components/card";
import { Input } from "@restai/ui/components/input";
import { Label } from "@restai/ui/components/label";
import { Button } from "@restai/ui/components/button";
import { Upload } from "lucide-react";
import { useOrgSettings, useUpdateOrg } from "@/hooks/use-settings";
import { useUploadImage } from "@/hooks/use-uploads";
import { toast } from "sonner";

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-muted rounded ${className ?? ""}`} />;
}

export function OrgTab() {
  const { data: orgData, isLoading: orgLoading } = useOrgSettings();
  const updateOrg = useUpdateOrg();
  const uploadImage = useUploadImage();
  const logoFileRef = useRef<HTMLInputElement>(null);

  const [orgForm, setOrgForm] = useState({ name: "", logoUrl: "" });

  useEffect(() => {
    if (orgData) {
      setOrgForm({
        name: orgData.name || "",
        logoUrl: orgData.logo_url || "",
      });
    }
  }, [orgData]);

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

  return (
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
                    className="h-24 w-24 rounded-lg object-cover border"
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
  );
}
