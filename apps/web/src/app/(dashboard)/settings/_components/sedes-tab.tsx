"use client";

import { useState } from "react";
import { Card, CardContent } from "@restai/ui/components/card";
import { Input } from "@restai/ui/components/input";
import { Label } from "@restai/ui/components/label";
import { Button } from "@restai/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@restai/ui/components/dialog";
import { Plus, Pencil, Store, AlertTriangle, QrCode, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useBranches, useCreateBranch, useUpdateBranchById, type Branch } from "@/hooks/use-settings";
import { toast } from "sonner";

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse bg-muted rounded ${className ?? ""}`} />;
}

/** El slug viaja en la URL del comensal: solo minúsculas, números y guiones. */
const SLUG_RE = /^[a-z0-9-]+$/;
/** El servidor exige al menos 2 caracteres en nombre y slug (createBranchSchema). */
const MIN_LARGO = 2;

function slugify(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    // Un espacio final dejaba un guion suelto ("sede-centro-"): queda feo en la
    // URL del comensal y en cada QR impreso, y `.trim()` no lo quitaba.
    .replace(/^-+|-+$/g, "");
}

export function SedesTab({
  canCreate,
  canEdit,
}: {
  canCreate: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const {
    data: branches,
    isLoading: branchesLoading,
    error: branchesError,
    refetch: refetchBranches,
  } = useBranches();
  const createBranch = useCreateBranch();
  const updateBranchById = useUpdateBranchById();

  const [branchDialogOpen, setBranchDialogOpen] = useState(false);
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [branchDialogForm, setBranchDialogForm] = useState({
    name: "",
    slug: "",
    address: "",
    phone: "",
  });
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [confirmSlugOpen, setConfirmSlugOpen] = useState(false);
  /** Aviso persistente tras invalidar los QR: un toast se va antes de leerlo. */
  const [qrAviso, setQrAviso] = useState<{
    branchName: string;
    slug: string;
    tables: number;
  } | null>(null);

  const openCreateBranchDialog = () => {
    setEditingBranch(null);
    setBranchDialogForm({ name: "", slug: "", address: "", phone: "" });
    setSlugManuallyEdited(false);
    setBranchDialogOpen(true);
  };

  const openEditBranchDialog = (branch: Branch) => {
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

  const nombreLimpio = branchDialogForm.name.trim();
  const nombreInvalido = nombreLimpio.length > 0 && nombreLimpio.length < MIN_LARGO;
  const slugLimpio = branchDialogForm.slug.trim();
  const slugInvalido =
    slugLimpio.length > 0 && (!SLUG_RE.test(slugLimpio) || slugLimpio.length < MIN_LARGO);
  /** Editar y cambiar el slug rompe todos los QR impresos de esa sede. */
  const slugCambia = !!editingBranch && slugLimpio !== editingBranch.slug;
  const guardando = createBranch.isPending || updateBranchById.isPending;

  const persistirSede = async () => {
    try {
      if (editingBranch) {
        const result = await updateBranchById.mutateAsync({
          id: editingBranch.id,
          name: branchDialogForm.name.trim(),
          slug: slugLimpio,
          address: branchDialogForm.address.trim(),
          phone: branchDialogForm.phone.trim(),
        });
        setConfirmSlugOpen(false);
        setBranchDialogOpen(false);
        if (result.qr_invalidated) {
          setQrAviso({
            branchName: result.data?.name ?? branchDialogForm.name.trim(),
            slug: result.data?.slug ?? slugLimpio,
            tables: result.affected_tables ?? 0,
          });
          toast.warning(
            `Sede guardada. Los QR de ${result.affected_tables} mesa(s) dejaron de funcionar: reimprímelos.`,
          );
        } else {
          toast.success("Sede actualizada correctamente");
        }
      } else {
        await createBranch.mutateAsync({
          name: branchDialogForm.name.trim(),
          slug: slugLimpio,
          address: branchDialogForm.address.trim() || undefined,
          phone: branchDialogForm.phone.trim() || undefined,
        });
        setBranchDialogOpen(false);
        toast.success("Sede creada correctamente");
      }
    } catch (err: any) {
      setConfirmSlugOpen(false);
      if (err?.code === "CONFLICT") {
        toast.error("Ese slug ya lo usa otra sede de tu organización. Elige otro.");
        return;
      }
      if (err?.code === "FORBIDDEN") {
        toast.error("No tienes acceso a esta sede.");
        return;
      }
      toast.error(err?.message || "No se pudo guardar la sede");
    }
  };

  const handleBranchDialogSave = () => {
    if (!nombreLimpio || nombreInvalido) {
      toast.error("El nombre de la sede necesita al menos 2 caracteres");
      return;
    }
    if (!slugLimpio || slugInvalido) {
      toast.error("El slug admite minúsculas, números y guiones, con 2 caracteres como mínimo");
      return;
    }
    // Cambiar el slug se confirma SIEMPRE: es la única acción de esta pantalla
    // que invalida material impreso.
    if (slugCambia) {
      setConfirmSlugOpen(true);
      return;
    }
    void persistirSede();
  };

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Todas las sedes</h2>
          <p className="text-sm text-muted-foreground">
            Cada sede tiene su propia carta, sus mesas y sus series de comprobantes.
          </p>
        </div>
        {canCreate && (
          <Button className="h-10" onClick={openCreateBranchDialog}>
            <Plus className="h-4 w-4 mr-2" />
            Nueva sede
          </Button>
        )}
      </div>

      {qrAviso && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-amber-500/50 bg-amber-500/10 p-4"
        >
          <div className="flex items-start gap-3">
            <QrCode className="h-5 w-5 mt-0.5 shrink-0 text-amber-600" />
            <div className="min-w-0 space-y-2">
              <p className="text-sm font-medium">
                Los códigos QR de {qrAviso.branchName} ya no funcionan
              </p>
              <p className="text-sm text-muted-foreground">
                La dirección de la sede pasó a ser <span className="font-mono">/{qrAviso.slug}</span>.
                Los stickers impresos de {qrAviso.tables} mesa(s) apuntan a la anterior y llevan a
                una página de error. Reimprímelos desde Mesas antes del próximo servicio.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" className="h-10" onClick={() => router.push("/tables")}>
                  Ir a Mesas y reimprimir
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-10"
                  onClick={() => setQrAviso(null)}
                >
                  Entendido
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {branchesError ? (
        <div
          role="alert"
          className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/50 bg-destructive/5 p-4"
        >
          <p className="text-sm text-destructive">
            No se pudieron cargar las sedes: {(branchesError as Error).message}
          </p>
          <Button variant="outline" size="sm" className="h-10" onClick={() => void refetchBranches()}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Reintentar
          </Button>
        </div>
      ) : branchesLoading ? (
        <div className="mt-4 space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : !branches || branches.length === 0 ? (
        <Card className="mt-4">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Store className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="font-medium">Todavía no hay sedes</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Una sede es un local físico: tiene sus mesas, su carta y su numeración de
              comprobantes. Crea la primera para empezar a operar.
            </p>
            {canCreate ? (
              <Button className="mt-4 h-10" onClick={openCreateBranchDialog}>
                <Plus className="h-4 w-4 mr-2" />
                Crear primera sede
              </Button>
            ) : (
              <p className="mt-4 text-xs text-muted-foreground">
                Pide al administrador de la organización que cree la primera sede.
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="mt-4 space-y-3">
          {branches.map((branch) => (
            <Card key={branch.id}>
              <CardContent className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-4">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/10 text-primary">
                      <Store className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-medium">{branch.name}</p>
                      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                          /{branch.slug}
                        </span>
                        {branch.address && <span className="truncate">{branch.address}</span>}
                        {branch.phone && <span>{branch.phone}</span>}
                      </div>
                    </div>
                  </div>
                  {canEdit && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-10"
                      aria-label={`Editar la sede ${branch.name}`}
                      onClick={() => openEditBranchDialog(branch)}
                    >
                      <Pencil className="h-4 w-4 sm:mr-2" />
                      <span className="hidden sm:inline">Editar</span>
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={branchDialogOpen} onOpenChange={setBranchDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingBranch ? "Editar sede" : "Nueva sede"}</DialogTitle>
            <DialogDescription>
              {editingBranch
                ? "Modifica los datos del local."
                : "Añade un local nuevo a tu organización."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="dialogBranchName">Nombre</Label>
              <Input
                id="dialogBranchName"
                className="h-10"
                placeholder="Sede Centro"
                value={branchDialogForm.name}
                aria-invalid={nombreInvalido}
                aria-describedby="dialogBranchNameHelp"
                onChange={(e) => {
                  const name = e.target.value;
                  setBranchDialogForm({
                    ...branchDialogForm,
                    name,
                    slug: slugManuallyEdited ? branchDialogForm.slug : slugify(name),
                  });
                }}
              />
              {nombreInvalido && (
                <p id="dialogBranchNameHelp" role="alert" className="text-xs text-destructive">
                  El nombre necesita al menos 2 caracteres.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="dialogBranchSlug">Slug (dirección web)</Label>
              <Input
                id="dialogBranchSlug"
                className="h-10 font-mono"
                placeholder="sede-centro"
                value={branchDialogForm.slug}
                aria-invalid={slugInvalido}
                aria-describedby="dialogBranchSlugHelp"
                onChange={(e) => {
                  setSlugManuallyEdited(true);
                  setBranchDialogForm({ ...branchDialogForm, slug: e.target.value });
                }}
              />
              {slugInvalido ? (
                <p id="dialogBranchSlugHelp" role="alert" className="text-xs text-destructive">
                  Solo minúsculas, números y guiones, con 2 caracteres como mínimo. Sin espacios
                  ni tildes.
                </p>
              ) : (
                <p id="dialogBranchSlugHelp" className="text-xs text-muted-foreground">
                  Forma parte del enlace del comensal y de todos los códigos QR de las mesas.
                </p>
              )}
              {slugCambia && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3"
                >
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
                  <p className="text-xs">
                    Vas a cambiar el slug de{" "}
                    <span className="font-mono">{editingBranch?.slug}</span> a{" "}
                    <span className="font-mono">{slugLimpio || "…"}</span>. Todos los códigos QR
                    impresos de esta sede dejarán de funcionar y habrá que reimprimirlos.
                  </p>
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="dialogBranchAddress">Dirección</Label>
              <Input
                id="dialogBranchAddress"
                className="h-10"
                placeholder="Av. Principal 123"
                value={branchDialogForm.address}
                onChange={(e) =>
                  setBranchDialogForm({ ...branchDialogForm, address: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dialogBranchPhone">Teléfono</Label>
              <Input
                id="dialogBranchPhone"
                className="h-10"
                inputMode="tel"
                placeholder="+51 999 999 999"
                value={branchDialogForm.phone}
                onChange={(e) =>
                  setBranchDialogForm({ ...branchDialogForm, phone: e.target.value })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="h-10"
              onClick={() => setBranchDialogOpen(false)}
              disabled={guardando}
            >
              Cancelar
            </Button>
            <Button
              className="h-10"
              onClick={handleBranchDialogSave}
              disabled={
                !nombreLimpio || nombreInvalido || !slugLimpio || slugInvalido || guardando
              }
            >
              {guardando ? "Guardando..." : editingBranch ? "Guardar" : "Crear sede"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmSlugOpen}
        onOpenChange={setConfirmSlugOpen}
        title="Esto invalida los QR impresos"
        description={`El enlace del comensal pasará de /${editingBranch?.slug} a /${slugLimpio}. Todos los códigos QR pegados en las mesas de ${editingBranch?.name ?? "esta sede"} dejarán de funcionar y tendrás que reimprimirlos desde Mesas. ¿Continuar?`}
        confirmLabel="Sí, cambiar el slug"
        variant="destructive"
        loading={updateBranchById.isPending}
        onConfirm={() => void persistirSede()}
      />
    </>
  );
}
