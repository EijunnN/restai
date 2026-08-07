"use client";

import { useEffect, useMemo, useState } from "react";
import { Input } from "@restai/ui/components/input";
import { Label } from "@restai/ui/components/label";
import { Button } from "@restai/ui/components/button";
import { Badge } from "@restai/ui/components/badge";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@restai/ui/components/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@restai/ui/components/dialog";
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  Mail,
  MailX,
  RefreshCw,
  Send,
  Ticket,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useAuthStore } from "@/stores/auth-store";
import { hasAllPermissions, hasPermission } from "@/lib/permissions";
import { useLoyaltyPrograms } from "@/hooks/use-loyalty";
import { useCoupons } from "@/hooks/use-coupons";
import {
  useCampaignAudience,
  useSendCampaign,
  DEFAULT_MAX_RECIPIENTS,
  type Campaign,
  type CampaignAudience,
  type SegmentFilter,
  type SendCampaignInput,
} from "@/hooks/use-campaigns";
import { SegmentBuilder, type TierOption } from "./segment-builder";
import {
  describeSegment,
  emptySegmentForm,
  isEmptySegment,
  lastVisitLabel,
  sameSegment,
  segmentFormToFilter,
  validateSegmentForm,
  type SegmentForm,
} from "./campaign-utils";

const textareaClass =
  "flex min-h-[7rem] w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm";

function StatBox({
  label,
  value,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: number;
  icon: typeof Users;
  tone?: "default" | "good" | "warn";
}) {
  const toneClass =
    tone === "good"
      ? "text-green-700 dark:text-green-400"
      : tone === "warn"
        ? "text-amber-700 dark:text-amber-400"
        : "text-foreground";
  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span>{label}</span>
      </div>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${toneClass}`}>
        {value.toLocaleString("es-PE")}
      </p>
    </div>
  );
}

/**
 * Anuncio de una campaña por correo.
 *
 * El flujo es deliberadamente en tres pasos: se define el segmento, se PULSA
 * "Previsualizar" y solo entonces se habilita "Enviar", con el número real de
 * destinatarios en el propio botón y en la confirmación. Tocar cualquier filtro
 * invalida la previsualización y vuelve a bloquear el envío: nunca se manda un
 * correo contra un conteo que ya no corresponde a lo que hay en pantalla.
 */
export function SendCampaignDialog({
  open,
  onOpenChange,
  campaign,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaign: Campaign;
}) {
  const role = useAuthStore((s) => s.user?.role);
  const canPreview = hasAllPermissions(role, ["loyalty:read", "customers:read"]);
  const canSend = hasPermission(role, "loyalty:create");

  const { data: programsData } = useLoyaltyPrograms();
  const programs: any[] = Array.isArray(programsData) ? programsData : [];
  const tiers: TierOption[] = programs.flatMap((p: any) =>
    (p.tiers ?? []).map((t: any) => ({
      id: t.id,
      name: t.name,
      programName: p.name,
    })),
  );

  const { data: couponsData, error: couponsError } = useCoupons({ status: "active" });
  const coupons: any[] = Array.isArray(couponsData) ? couponsData : [];

  const [segForm, setSegForm] = useState<SegmentForm>(emptySegmentForm);
  const [subject, setSubject] = useState("");
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [couponId, setCouponId] = useState("");
  const [maxRecipients, setMaxRecipients] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<CampaignAudience | null>(null);
  /** Segmento realmente previsualizado. null = todavía no se pulsó el botón. */
  const [previewSegment, setPreviewSegment] = useState<SegmentFilter | null>(null);

  const segmentError = validateSegmentForm(segForm);
  const segment = useMemo(() => segmentFormToFilter(segForm), [segForm]);

  const audience = useCampaignAudience(campaign.id, previewSegment, 8);
  const sendCampaign = useSendCampaign();

  // Reinicio total al abrir (o al cambiar de campaña): ni el texto ni el
  // resultado de un anuncio anterior deben arrastrarse al siguiente.
  useEffect(() => {
    if (!open) return;
    setSegForm(emptySegmentForm);
    setSubject("");
    setTitle("");
    setMessage("");
    setCouponId("");
    setMaxRecipients("");
    setConfirmOpen(false);
    setSnapshot(null);
    setPreviewSegment(null);
    sendCampaign.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, campaign.id]);

  const isEnded = campaign.status === "ended";
  // La previsualización solo vale mientras el segmento en pantalla siga siendo
  // el que se consultó: tocar un filtro la invalida y vuelve a bloquear el envío.
  const previewFresh = previewSegment !== null && sameSegment(previewSegment, segment);
  const preview = previewFresh ? audience.data : undefined;
  const previewed = !!preview;
  const sent = sendCampaign.isSuccess;

  const tierName = tiers.find((t) => t.id === segForm.tierId)?.name ?? null;

  const parsedMax = /^\d+$/.test(maxRecipients.trim())
    ? Number(maxRecipients.trim())
    : null;
  const maxError =
    maxRecipients.trim() !== "" && (parsedMax === null || parsedMax < 1 || parsedMax > 5000)
      ? "El máximo de destinatarios debe ser un entero entre 1 y 5000."
      : null;

  const effectiveCap = parsedMax ?? DEFAULT_MAX_RECIPIENTS;
  const willSend = preview ? Math.min(preview.reachable, effectiveCap) : 0;

  const subjectError =
    subject.trim().length > 180 ? "El asunto no puede pasar de 180 caracteres." : null;
  const titleError =
    title.trim().length > 180 ? "El título no puede pasar de 180 caracteres." : null;
  const messageError =
    message.trim().length > 4000 ? "El mensaje no puede pasar de 4000 caracteres." : null;

  const textErrors = !!(subjectError || titleError || messageError || maxError);

  const canPressSend =
    canSend && !isEnded && previewed && willSend > 0 && !textErrors && !sent;

  function buildBody(): SendCampaignInput {
    const body: SendCampaignInput = {};
    if (subject.trim()) body.subject = subject.trim();
    if (title.trim()) body.title = title.trim();
    if (message.trim()) body.message = message.trim();
    if (couponId) body.couponId = couponId;
    if (!isEmptySegment(segment)) body.segment = segment;
    if (parsedMax !== null) body.maxRecipients = parsedMax;
    return body;
  }

  function handleConfirmSend() {
    setSnapshot(preview ?? null);
    sendCampaign.mutate(
      { id: campaign.id, body: buildBody() },
      {
        onSuccess: (data) => {
          setConfirmOpen(false);
          toast.success(
            data.queued > 0
              ? `Anuncio encolado para ${data.queued.toLocaleString("es-PE")} cliente(s)`
              : "No había nadie a quien escribir en este segmento",
          );
        },
        onError: (err) => {
          setConfirmOpen(false);
          // El 409 de enfriamiento y el de campaña terminada vienen redactados
          // por el servidor: se muestran tal cual, no se reintentan.
          toast.error((err as Error).message);
        },
      },
    );
  }

  /** Solo se pide la audiencia cuando el dueño lo pide explícitamente. */
  function handlePreview() {
    if (segmentError) return;
    if (previewFresh) {
      // Mismo segmento: se fuerza una lectura nueva por si cambió la base.
      audience.refetch();
      return;
    }
    setPreviewSegment(segment);
  }

  const previewLoading = previewFresh && audience.isFetching;

  const audienceErrorMessage = (() => {
    if (!previewFresh || !audience.error) return null;
    const err = audience.error;
    if (err.code === "FORBIDDEN") {
      return "Tu rol no puede consultar la lista de clientes, así que no se puede previsualizar la audiencia.";
    }
    return err.message;
  })();

  // Un fallo al RECALCULAR no borra el conteo anterior de react-query, así que
  // antes se pintaban a la vez la banda roja y las cifras. Ahora la banda solo
  // aparece cuando no hay ningún conteo utilizable; si lo hay, se avisa de que
  // es el último cálculo bueno y se deja enviar contra él.
  const audienceFatalError = !preview ? audienceErrorMessage : null;
  const audienceStaleError = preview ? audienceErrorMessage : null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Anunciar «{campaign.name}»</DialogTitle>
            <DialogDescription>
              Elige el segmento, comprueba a cuántas personas llega de verdad y recién
              entonces envía. Solo se escribe a quien dio su consentimiento.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[62vh] space-y-6 overflow-y-auto pr-1">
            {isEnded && (
              <div
                role="alert"
                className="flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/5 p-3"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <p className="text-sm text-destructive">
                  Esta campaña está finalizada: no se puede anunciar una promoción
                  vencida. Cámbiala a activa si quieres volver a usarla.
                </p>
              </div>
            )}

            <SegmentBuilder
              value={segForm}
              onChange={setSegForm}
              tiers={tiers}
              disabled={sent}
              error={segmentError}
            />

            <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
              {describeSegment(segment, tierName)}
            </p>

            {/* ---------------------------------------------------------- */}
            <section className="space-y-4 border-t border-border pt-5">
              <div className="flex items-center gap-2">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-medium text-foreground">
                  2. ¿Qué les decimos?
                </h3>
              </div>
              <p className="text-xs text-muted-foreground">
                Todo es opcional: si lo dejas vacío se usa el nombre y la descripción de
                la campaña, con sus días, horario y beneficio.
              </p>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="send-subject">Asunto del correo</Label>
                  <Input
                    id="send-subject"
                    className="h-10"
                    value={subject}
                    disabled={sent}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder={campaign.name}
                    aria-invalid={!!subjectError}
                  />
                  {subjectError && (
                    <p role="alert" className="text-xs text-destructive">
                      {subjectError}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="send-title">Título dentro del correo</Label>
                  <Input
                    id="send-title"
                    className="h-10"
                    value={title}
                    disabled={sent}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder={campaign.name}
                    aria-invalid={!!titleError}
                  />
                  {titleError && (
                    <p role="alert" className="text-xs text-destructive">
                      {titleError}
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="send-message">Mensaje</Label>
                <textarea
                  id="send-message"
                  className={textareaClass}
                  value={message}
                  disabled={sent}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder={
                    campaign.description ||
                    "Cuéntales qué ganan y hasta cuándo. Si lo dejas vacío se redacta con los datos de la campaña."
                  }
                  aria-invalid={!!messageError}
                />
                <div className="flex items-center justify-between">
                  {messageError ? (
                    <p role="alert" className="text-xs text-destructive">
                      {messageError}
                    </p>
                  ) : (
                    <span />
                  )}
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {message.length}/4000
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="send-coupon">Cupón adjunto (opcional)</Label>
                  <Select
                    value={couponId || "none"}
                    onValueChange={(v) => setCouponId(v === "none" ? "" : v)}
                    disabled={sent}
                  >
                    <SelectTrigger id="send-coupon" className="h-10">
                      <SelectValue placeholder="Sin cupón" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sin cupón</SelectItem>
                      {coupons.map((coupon: any) => (
                        <SelectItem key={coupon.id} value={coupon.id}>
                          {coupon.code} — {coupon.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {/*
                    Un desplegable vacío por un fallo de carga se lee como "no
                    hay cupones": hay que distinguir las dos cosas o el dueño
                    envía el anuncio sin el cupón que quería adjuntar.
                  */}
                  {couponsError ? (
                    <p role="alert" className="text-xs text-destructive">
                      No se pudieron cargar los cupones: {(couponsError as Error).message}
                    </p>
                  ) : coupons.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No hay cupones activos. Crea uno en Fidelización si quieres
                      adjuntarlo al anuncio.
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Se asigna a cada destinatario para que su canje quede a su nombre.
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="send-max">Máximo de destinatarios</Label>
                  <Input
                    id="send-max"
                    className="h-10"
                    inputMode="numeric"
                    value={maxRecipients}
                    disabled={sent}
                    onChange={(e) => setMaxRecipients(e.target.value)}
                    placeholder={String(DEFAULT_MAX_RECIPIENTS)}
                    aria-invalid={!!maxError}
                  />
                  {maxError ? (
                    <p role="alert" className="text-xs text-destructive">
                      {maxError}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Sin indicar, el envío se limita a {DEFAULT_MAX_RECIPIENTS} correos.
                    </p>
                  )}
                </div>
              </div>
            </section>

            {/* ---------------------------------------------------------- */}
            <section className="space-y-3 border-t border-border pt-5">
              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-medium text-foreground">
                  3. ¿A cuántos llega?
                </h3>
              </div>

              {!canPreview && (
                <p role="alert" className="text-sm text-muted-foreground">
                  Tu rol no puede consultar la lista de clientes, así que no se puede
                  previsualizar la audiencia de esta campaña.
                </p>
              )}

              {canPreview && previewLoading && (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />
                  ))}
                </div>
              )}

              {canPreview && !previewLoading && audienceFatalError && (
                <div
                  role="alert"
                  className="flex flex-col gap-3 rounded-lg border border-destructive/50 bg-destructive/5 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <p className="text-sm text-destructive">{audienceFatalError}</p>
                  <Button
                    variant="outline"
                    className="h-10 shrink-0"
                    onClick={() => audience.refetch()}
                    disabled={audience.isFetching}
                    aria-label="Reintentar la previsualización de audiencia"
                  >
                    <RefreshCw
                      className={`mr-2 h-4 w-4 ${audience.isFetching ? "animate-spin" : ""}`}
                    />
                    Reintentar
                  </Button>
                </div>
              )}

              {canPreview && !previewLoading && !audienceFatalError && !preview && (
                <p className="text-sm text-muted-foreground">
                  Pulsa «Previsualizar» para ver a cuántas personas alcanza este segmento.
                  No se envía nada.
                </p>
              )}

              {canPreview && !previewLoading && preview && (
                <div className="space-y-3">
                  {audienceStaleError && (
                    <p
                      role="alert"
                      className="text-xs text-amber-700 dark:text-amber-400"
                    >
                      No se pudo actualizar el conteo ({audienceStaleError}). Se muestra
                      el último cálculo correcto.
                    </p>
                  )}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <StatBox label="Cumplen el segmento" value={preview.total} icon={Users} />
                    <StatBox
                      label="Se les puede escribir"
                      value={preview.reachable}
                      icon={Mail}
                      tone="good"
                    />
                    <StatBox
                      label="Sin correo o sin permiso"
                      value={preview.unreachable}
                      icon={MailX}
                      tone="warn"
                    />
                  </div>

                  {preview.reachable === 0 ? (
                    <div
                      role="alert"
                      className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3"
                    >
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                      <p className="text-sm text-amber-900 dark:text-amber-200">
                        Nadie de este segmento tiene correo y consentimiento de marketing,
                        así que no hay a quién escribir. Pide el permiso en la próxima
                        visita o prueba con un segmento más amplio.
                      </p>
                    </div>
                  ) : (
                    <>
                      {preview.unreachable > 0 && (
                        <p className="text-xs text-muted-foreground">
                          {preview.unreachable.toLocaleString("es-PE")} cliente(s) del
                          segmento se quedan fuera por no tener correo o no haber aceptado
                          recibir promociones. Pedir ese permiso en sala es la forma más
                          barata de ampliar el alcance.
                        </p>
                      )}
                      {preview.reachable > effectiveCap && (
                        <p className="text-xs text-amber-700 dark:text-amber-400">
                          Este envío llegará solo a {effectiveCap.toLocaleString("es-PE")}{" "}
                          de los {preview.reachable.toLocaleString("es-PE")} alcanzables
                          por el máximo de destinatarios.
                        </p>
                      )}
                      {preview.sample.length > 0 && (
                        <div className="rounded-lg border border-border">
                          <p className="border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
                            Muestra de destinatarios
                          </p>
                          <ul className="divide-y divide-border">
                            {preview.sample.map((customer) => (
                              <li
                                key={customer.id}
                                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                              >
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-foreground">
                                    {customer.name}
                                  </p>
                                  <p className="truncate text-xs text-muted-foreground">
                                    {customer.email ?? "Sin correo"} ·{" "}
                                    {lastVisitLabel(customer.last_visit_at)}
                                  </p>
                                </div>
                                <div className="flex shrink-0 items-center gap-2">
                                  {customer.tier_name && (
                                    <Badge variant="outline" className="text-[10px]">
                                      {customer.tier_name}
                                    </Badge>
                                  )}
                                  <span className="text-xs tabular-nums text-muted-foreground">
                                    {customer.points_balance.toLocaleString("es-PE")} pts
                                  </span>
                                </div>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </section>

            {/* ---------------------------------------------------------- */}
            {sent && sendCampaign.data && (
              <section
                className="space-y-2 rounded-lg border border-green-600/40 bg-green-500/5 p-4"
                aria-live="polite"
              >
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                  <p className="font-medium text-green-800 dark:text-green-300">
                    {sendCampaign.data.message}
                  </p>
                </div>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  <li>
                    Correos encolados:{" "}
                    <span className="font-medium text-foreground tabular-nums">
                      {sendCampaign.data.queued.toLocaleString("es-PE")}
                    </span>
                  </li>
                  {snapshot && snapshot.unreachable > 0 && (
                    <li>
                      Omitidos por falta de correo o de consentimiento:{" "}
                      <span className="font-medium text-foreground tabular-nums">
                        {snapshot.unreachable.toLocaleString("es-PE")}
                      </span>
                    </li>
                  )}
                  {sendCampaign.data.audience > sendCampaign.data.queued && (
                    <li>
                      No entraron por el máximo de destinatarios:{" "}
                      <span className="font-medium text-foreground tabular-nums">
                        {(
                          sendCampaign.data.audience - sendCampaign.data.queued
                        ).toLocaleString("es-PE")}
                      </span>
                    </li>
                  )}
                  {sendCampaign.data.couponCode && (
                    <li className="flex items-center gap-1.5">
                      <Ticket className="h-3.5 w-3.5" />
                      Cupón adjunto:{" "}
                      <span className="font-mono font-medium text-foreground">
                        {sendCampaign.data.couponCode}
                      </span>
                    </li>
                  )}
                </ul>
                <p className="text-xs text-muted-foreground">
                  La entrega es asíncrona: los correos salen en lotes durante los
                  próximos minutos. Hay un minuto de espera antes de poder volver a
                  anunciar esta misma campaña.
                </p>
              </section>
            )}

            {sendCampaign.isError && !sent && (
              <div
                role="alert"
                className="flex items-start gap-3 rounded-lg border border-destructive/50 bg-destructive/5 p-3"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <p className="text-sm text-destructive">
                  {(sendCampaign.error as Error).message}
                </p>
              </div>
            )}
          </div>

          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              className="h-10"
              onClick={() => onOpenChange(false)}
            >
              {sent ? "Cerrar" : "Cancelar"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-10"
              onClick={handlePreview}
              disabled={!canPreview || !!segmentError || previewLoading || sent}
            >
              <Eye className="mr-2 h-4 w-4" />
              {previewLoading
                ? "Calculando..."
                : previewed
                  ? "Volver a previsualizar"
                  : "Previsualizar"}
            </Button>
            <Button
              type="button"
              className="h-10"
              onClick={() => setConfirmOpen(true)}
              disabled={!canPressSend || sendCampaign.isPending}
            >
              <Send className="mr-2 h-4 w-4" />
              {sent
                ? "Ya anunciada"
                : previewed
                  ? `Enviar a ${willSend.toLocaleString("es-PE")} clientes`
                  : "Previsualiza antes de enviar"}
            </Button>
          </DialogFooter>

          {!canSend && (
            <p className="text-xs text-muted-foreground">
              Tu rol no puede enviar anuncios de campañas.
            </p>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="¿Enviar este anuncio?"
        description={
          `Se enviará «${campaign.name}» por correo a ${willSend.toLocaleString("es-PE")} cliente(s) ` +
          "con correo y consentimiento de marketing. Los correos ya enviados no se pueden retirar." +
          (couponId ? " El cupón elegido quedará asignado a cada destinatario." : "")
        }
        confirmLabel={`Sí, enviar a ${willSend.toLocaleString("es-PE")}`}
        variant="default"
        loading={sendCampaign.isPending}
        onConfirm={handleConfirmSend}
      />
    </>
  );
}
