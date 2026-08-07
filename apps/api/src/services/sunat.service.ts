import { and, count, desc, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { X509Certificate } from "node:crypto";
import { db, schema, type DbOrTx } from "@restai/db";
import {
  SunatClient,
  SunatSoapError,
  buildInvoiceXml,
  getStatus,
  pfxToPem,
  mapDocType,
  mapTipoComprobante,
  montoEnLetras,
  ENDPOINTS,
  IGV_TASA,
  TIPO_AFECTACION_IGV,
  TIPO_COMPROBANTE,
  TIPO_DOCUMENTO_IDENTIDAD,
  UNIDAD_MEDIDA,
  type Ambiente,
  type Comprobante,
  type ComunicacionBaja,
  type DetalleItem,
  type Emisor,
  type Nota,
  type ResumenDiario,
  type ResumenDiarioItem,
  type SunatConfig as SunatClientConfig,
  type SunatResult,
  type Totales,
} from "@restai/sunat";
import { decryptSecret, isEncryptionAvailable } from "../lib/crypto.js";
import { logger } from "../lib/logger.js";
import { peruCivilDate, peruCivilDayEnd, peruCivilDayStart } from "../lib/timezone.js";

type InvoiceRow = typeof schema.invoices.$inferSelect;
type OrderItemRow = typeof schema.orderItems.$inferSelect;
type SunatConfigRow = typeof schema.sunatConfig.$inferSelect;

/**
 * Error de CONFIGURACIÓN de la facturación electrónica: no hay emisor dado de
 * alta, está deshabilitado, faltan credenciales o el certificado no sirve.
 * Siempre trae un `code` accionable para que la UI sepa a dónde mandar al
 * usuario en lugar de mostrar un 500 opaco.
 */
export class SunatConfigError extends Error {
  code: string;
  constructor(message: string, code = "SUNAT_NOT_CONFIGURED") {
    super(message);
    this.name = "SunatConfigError";
    this.code = code;
  }
}

/** Error del DOCUMENTO: el comprobante no se puede construir o no admite la operación pedida. */
export class SunatDocumentError extends Error {
  code: string;
  constructor(message: string, code = "SUNAT_DOCUMENT_INVALID") {
    super(message);
    this.name = "SunatDocumentError";
    this.code = code;
  }
}

/** Mensaje único y accionable para el caso "no está configurado". */
const MENSAJE_SIN_CONFIGURAR =
  "Configura la facturación electrónica en Ajustes > SUNAT";

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Tolerancia de céntimo con la que SUNAT valida las sumas de un comprobante. */
const TOLERANCIA = 0.005;

// ───────────────────────────────────────────────────────────────────────────
// Series por tipo de comprobante
// ───────────────────────────────────────────────────────────────────────────

/**
 * Series de numeración de la SEDE. Van por sede (no por organización) porque
 * dos locales del mismo RUC que emitan F001-1 chocan ante SUNAT: cada
 * establecimiento necesita su propia serie.
 *
 * Se guardan en `branches.settings.sunat_series` mediante una fusión jsonb
 * atómica (`settings || '{...}'`), de modo que escribirlas nunca pisa el resto
 * de ajustes de la sede.
 */
export interface SeriesConfig {
  /** Serie de boletas de venta (empieza en B). */
  boleta: string;
  /** Serie de facturas (empieza en F). */
  factura: string;
  /** Serie de las notas de crédito que afectan a una boleta (empieza en B). */
  nota_credito_boleta: string;
  /** Serie de las notas de crédito que afectan a una factura (empieza en F). */
  nota_credito_factura: string;
}

export const SERIES_POR_DEFECTO: SeriesConfig = {
  boleta: "B001",
  factura: "F001",
  nota_credito_boleta: "BC01",
  nota_credito_factura: "FC01",
};

/** Una serie válida son 4 caracteres: la letra del tipo + 3 alfanuméricos. */
const SERIE_BOLETA_RE = /^B[A-Z0-9]{3}$/;
const SERIE_FACTURA_RE = /^F[A-Z0-9]{3}$/;

export function validarSeries(series: SeriesConfig): string[] {
  const errores: string[] = [];
  if (!SERIE_BOLETA_RE.test(series.boleta)) {
    errores.push("La serie de boletas debe ser B + 3 caracteres (ej. B001)");
  }
  if (!SERIE_FACTURA_RE.test(series.factura)) {
    errores.push("La serie de facturas debe ser F + 3 caracteres (ej. F001)");
  }
  if (!SERIE_BOLETA_RE.test(series.nota_credito_boleta)) {
    errores.push(
      "La serie de notas de crédito de boleta debe ser B + 3 caracteres (ej. BC01)",
    );
  }
  if (!SERIE_FACTURA_RE.test(series.nota_credito_factura)) {
    errores.push(
      "La serie de notas de crédito de factura debe ser F + 3 caracteres (ej. FC01)",
    );
  }
  return errores;
}

/** Lee las series de la sede, completando con los valores por defecto. */
export async function loadSeries(
  branchId: string,
  conn: DbOrTx = db,
): Promise<SeriesConfig> {
  const [row] = await conn
    .select({ settings: schema.branches.settings })
    .from(schema.branches)
    .where(eq(schema.branches.id, branchId))
    .limit(1);

  const guardadas = (row?.settings as any)?.sunat_series as
    | Partial<SeriesConfig>
    | undefined;

  const series: SeriesConfig = {
    boleta: guardadas?.boleta ?? SERIES_POR_DEFECTO.boleta,
    factura: guardadas?.factura ?? SERIES_POR_DEFECTO.factura,
    nota_credito_boleta:
      guardadas?.nota_credito_boleta ?? SERIES_POR_DEFECTO.nota_credito_boleta,
    nota_credito_factura:
      guardadas?.nota_credito_factura ??
      SERIES_POR_DEFECTO.nota_credito_factura,
  };

  // Si alguien dejó una serie corrupta en los ajustes no se emite basura: se
  // avisa y se cae al valor por defecto, que siempre es válido.
  const errores = validarSeries(series);
  if (errores.length) {
    logger.warn("Series SUNAT inválidas en los ajustes de la sede", {
      branchId,
      errores,
    });
    return { ...SERIES_POR_DEFECTO };
  }
  return series;
}

/** Guarda las series de la sede sin pisar el resto de `branches.settings`. */
export async function saveSeries(
  branchId: string,
  series: SeriesConfig,
  conn: DbOrTx = db,
): Promise<void> {
  const errores = validarSeries(series);
  if (errores.length) {
    throw new SunatConfigError(errores.join("; "), "SUNAT_SERIES_INVALID");
  }
  await conn
    .update(schema.branches)
    .set({
      settings: sql`coalesce(${schema.branches.settings}, '{}'::jsonb) || ${JSON.stringify(
        { sunat_series: series },
      )}::jsonb` as any,
      updated_at: new Date(),
    })
    .where(eq(schema.branches.id, branchId));
}

/** Serie que corresponde a la nota de crédito de un comprobante dado. */
export function serieNotaCredito(
  tipoReferencia: string,
  series: SeriesConfig,
): string {
  return tipoReferencia === "factura"
    ? series.nota_credito_factura
    : series.nota_credito_boleta;
}

// ───────────────────────────────────────────────────────────────────────────
// Carga de configuración
// ───────────────────────────────────────────────────────────────────────────

interface LoadOptions {
  /**
   * Exigir que la facturación esté habilitada. Se desactiva al PROBAR la
   * conexión: el cliente configura primero, prueba, y recién entonces activa.
   */
  requireEnabled?: boolean;
}

/** Devuelve la fila de configuración o lanza un error accionable si no existe. */
export async function getSunatConfigRow(
  organizationId: string,
  conn: DbOrTx = db,
): Promise<SunatConfigRow | null> {
  const [row] = await conn
    .select()
    .from(schema.sunatConfig)
    .where(eq(schema.sunatConfig.organization_id, organizationId))
    .limit(1);
  return row ?? null;
}

/** Carga y descifra la configuración SUNAT de una organización. */
export async function loadSunatConfig(
  organizationId: string,
  conn: DbOrTx = db,
  options: LoadOptions = {},
): Promise<{ row: SunatConfigRow; client: SunatClient; emisor: Emisor }> {
  const { requireEnabled = true } = options;

  const row = await getSunatConfigRow(organizationId, conn);
  if (!row) {
    throw new SunatConfigError(MENSAJE_SIN_CONFIGURAR, "SUNAT_NOT_CONFIGURED");
  }
  if (requireEnabled && !row.enabled) {
    throw new SunatConfigError(
      "La facturación electrónica está guardada pero desactivada. Actívala en Ajustes > SUNAT.",
      "SUNAT_DISABLED",
    );
  }
  if (!row.sol_user_enc || !row.sol_pass_enc || !row.cert_enc) {
    throw new SunatConfigError(
      "Faltan el usuario SOL, la clave SOL o el certificado digital. Complétalos en Ajustes > SUNAT.",
      "SUNAT_CREDENTIALS_MISSING",
    );
  }
  if (!isEncryptionAvailable()) {
    throw new SunatConfigError(
      "El servidor no tiene SUNAT_ENCRYPTION_KEY configurada: no se pueden descifrar las credenciales guardadas.",
      "SUNAT_ENCRYPTION_UNAVAILABLE",
    );
  }

  const emisor = emisorDeFila(row);

  let certificadoPem: string;
  let llavePrivadaPem: string | undefined;
  try {
    const certDescifrado = decryptSecret(row.cert_enc);
    if (row.cert_format === "pem") {
      certificadoPem = certDescifrado;
    } else {
      const pass = row.cert_pass_enc ? decryptSecret(row.cert_pass_enc) : "";
      const keys = pfxToPem(certDescifrado, pass);
      certificadoPem = keys.certificatePem;
      llavePrivadaPem = keys.privateKeyPem;
    }
  } catch (err) {
    throw new SunatConfigError(
      `No se pudo leer el certificado digital: ${
        err instanceof Error ? err.message : String(err)
      }. Vuelve a subirlo en Ajustes > SUNAT.`,
      "SUNAT_CERT_INVALID",
    );
  }

  let usuarioSol: string;
  let claveSol: string;
  try {
    usuarioSol = decryptSecret(row.sol_user_enc);
    claveSol = decryptSecret(row.sol_pass_enc);
  } catch {
    throw new SunatConfigError(
      "No se pudieron descifrar las credenciales SOL (¿cambió SUNAT_ENCRYPTION_KEY?). Vuelve a guardarlas en Ajustes > SUNAT.",
      "SUNAT_CREDENTIALS_UNREADABLE",
    );
  }

  const clientConfig: SunatClientConfig = {
    ambiente: row.ambiente,
    usuarioSol,
    claveSol,
    certificadoPem,
    llavePrivadaPem,
    emisor,
    endpointOverride: row.endpoint_override ?? undefined,
  };

  return { row, client: new SunatClient(clientConfig), emisor };
}

function emisorDeFila(row: SunatConfigRow): Emisor {
  return {
    ruc: row.ruc,
    razonSocial: row.razon_social,
    nombreComercial: row.nombre_comercial ?? undefined,
    ubigeo: row.ubigeo ?? undefined,
    departamento: row.departamento ?? undefined,
    provincia: row.provincia ?? undefined,
    distrito: row.distrito ?? undefined,
    direccion: row.direccion ?? undefined,
    codigoPais: "PE",
  };
}

/** Endpoint SOAP efectivo (el override manual gana sobre el del ambiente). */
export function endpointEfectivo(row: SunatConfigRow): string {
  return row.endpoint_override ?? ENDPOINTS[row.ambiente as Ambiente];
}

// ───────────────────────────────────────────────────────────────────────────
// Vista segura de la configuración (nunca devuelve secretos)
// ───────────────────────────────────────────────────────────────────────────

export interface CertificadoInfo {
  presente: boolean;
  /** "pfx" | "pem" */
  formato: string;
  /** true si se pudo abrir Y está dentro de su periodo de validez. */
  valido: boolean;
  motivo?: string;
  sujeto?: string;
  emisor?: string;
  validoDesde?: string;
  validoHasta?: string;
  /** Días que faltan para que caduque (negativo si ya caducó). */
  diasParaVencer?: number;
}

/**
 * Abre el certificado guardado y describe su estado SIN devolverlo nunca en
 * claro. "Certificado vencido" es la avería número uno de la facturación
 * electrónica: conviene verla antes de que SUNAT rechace una venta.
 */
export function inspeccionarCertificado(row: SunatConfigRow): CertificadoInfo {
  const formato = row.cert_format ?? "pfx";
  if (!row.cert_enc) {
    return { presente: false, formato, valido: false, motivo: "No se ha subido ningún certificado" };
  }
  if (!isEncryptionAvailable()) {
    return {
      presente: true,
      formato,
      valido: false,
      motivo: "SUNAT_ENCRYPTION_KEY no está configurada en el servidor",
    };
  }
  try {
    const descifrado = decryptSecret(row.cert_enc);
    const pem =
      formato === "pem"
        ? descifrado
        : pfxToPem(descifrado, row.cert_pass_enc ? decryptSecret(row.cert_pass_enc) : "")
            .certificatePem;

    const x509 = new X509Certificate(pem);
    const desde = new Date(x509.validFrom);
    const hasta = new Date(x509.validTo);
    const ahora = Date.now();
    const dias = Math.floor((hasta.getTime() - ahora) / 86_400_000);

    let motivo: string | undefined;
    let valido = true;
    if (ahora < desde.getTime()) {
      valido = false;
      motivo = "El certificado todavía no es válido (fecha de inicio futura)";
    } else if (ahora > hasta.getTime()) {
      valido = false;
      motivo = "El certificado está vencido: renuévalo con tu proveedor";
    } else if (dias <= 30) {
      motivo = `El certificado vence en ${dias} día(s): renuévalo antes de que caduque`;
    }

    return {
      presente: true,
      formato,
      valido,
      motivo,
      sujeto: x509.subject,
      emisor: x509.issuer,
      validoDesde: desde.toISOString(),
      validoHasta: hasta.toISOString(),
      diasParaVencer: dias,
    };
  } catch (err) {
    return {
      presente: true,
      formato,
      valido: false,
      motivo: `No se pudo abrir el certificado: ${
        err instanceof Error ? err.message : String(err)
      } (¿clave del PFX incorrecta?)`,
    };
  }
}

/** Enmascara el usuario SOL: confirma cuál se guardó sin revelarlo entero. */
function enmascararUsuarioSol(row: SunatConfigRow): string | null {
  if (!row.sol_user_enc || !isEncryptionAvailable()) return null;
  try {
    const usuario = decryptSecret(row.sol_user_enc);
    if (usuario.length <= 2) return "*".repeat(usuario.length);
    return `${usuario.slice(0, 2)}${"*".repeat(Math.max(3, usuario.length - 2))}`;
  } catch {
    return null;
  }
}

export interface SunatConfigView {
  configurado: boolean;
  id: string;
  organization_id: string;
  ruc: string;
  razon_social: string;
  nombre_comercial: string | null;
  ubigeo: string | null;
  departamento: string | null;
  provincia: string | null;
  distrito: string | null;
  direccion: string | null;
  ambiente: string;
  endpoint_override: string | null;
  endpoint_efectivo: string;
  enabled: boolean;
  /** true si hay usuario Y clave SOL guardados. */
  tiene_credenciales_sol: boolean;
  /** Usuario SOL enmascarado (nunca la clave). */
  usuario_sol_enmascarado: string | null;
  certificado: CertificadoInfo;
  /**
   * Última vez que se guardó la configuración. Es la mejor aproximación
   * disponible a la "fecha de carga" de los secretos: la tabla no lleva una
   * marca por secreto.
   */
  secretos_actualizados_en: Date;
  created_at: Date;
  updated_at: Date;
  /** Series de la sede consultada (null si la petición no trae sede). */
  series: SeriesConfig | null;
  /** Avisos accionables para pintar en la UI. */
  advertencias: string[];
}

/** Arma la vista de configuración que sí se puede devolver al frontend. */
export async function describeSunatConfig(
  organizationId: string,
  branchId: string | null,
  conn: DbOrTx = db,
): Promise<SunatConfigView | null> {
  const row = await getSunatConfigRow(organizationId, conn);
  if (!row) return null;

  const certificado = inspeccionarCertificado(row);
  const series = branchId ? await loadSeries(branchId, conn) : null;

  const advertencias: string[] = [];
  if (!isEncryptionAvailable()) {
    advertencias.push(
      "El servidor no tiene SUNAT_ENCRYPTION_KEY: no se pueden guardar ni leer secretos.",
    );
  }
  if (!row.sol_user_enc || !row.sol_pass_enc) {
    advertencias.push("Faltan las credenciales del usuario secundario SOL.");
  }
  if (certificado.motivo) advertencias.push(certificado.motivo);
  if (!row.enabled) {
    advertencias.push(
      "La facturación electrónica está desactivada: los comprobantes se emitirán solo en el sistema, sin declararse a SUNAT.",
    );
  }
  if (row.ambiente === "beta") {
    advertencias.push(
      "Ambiente BETA (pruebas): los comprobantes enviados no tienen validez fiscal.",
    );
  }

  return {
    configurado: true,
    id: row.id,
    organization_id: row.organization_id,
    ruc: row.ruc,
    razon_social: row.razon_social,
    nombre_comercial: row.nombre_comercial,
    ubigeo: row.ubigeo,
    departamento: row.departamento,
    provincia: row.provincia,
    distrito: row.distrito,
    direccion: row.direccion,
    ambiente: row.ambiente,
    endpoint_override: row.endpoint_override,
    endpoint_efectivo: endpointEfectivo(row),
    enabled: row.enabled,
    tiene_credenciales_sol: !!(row.sol_user_enc && row.sol_pass_enc),
    usuario_sol_enmascarado: enmascararUsuarioSol(row),
    certificado,
    secretos_actualizados_en: row.updated_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    series,
    advertencias,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Prueba de conexión
// ───────────────────────────────────────────────────────────────────────────

/** Códigos de SUNAT que significan "las credenciales SOL no sirven". */
const CODIGOS_CREDENCIALES = new Set([
  "0102", // Usuario o contraseña incorrectos
  "0103", // El usuario ingresado no existe
  "0104", // La clave ingresada es incorrecta
  "0105", // El usuario no está activo
  "0106", // El usuario no es válido para el servicio
  "0111", // No está autorizado a enviar comprobantes
  "0113", // El usuario no está afiliado
]);

export interface SunatTestResult {
  ok: boolean;
  ambiente: string;
  endpoint: string;
  habilitado: boolean;
  certificado: CertificadoInfo;
  firma: { ok: boolean; motivo?: string };
  conexion: { ok: boolean; codigo?: string; motivo?: string };
  credenciales: { ok: boolean; codigo?: string; motivo?: string };
  /** Resumen en una frase, listo para mostrar como toast. */
  mensaje: string;
  /** Milisegundos que tardó la llamada a SUNAT. */
  duracion_ms: number;
}

/** Corta una promesa que tarda demasiado (el SOAP de SUNAT no tiene timeout propio). */
async function conTiempoLimite<T>(
  promesa: Promise<T>,
  ms: number,
  mensaje: string,
): Promise<T> {
  let temporizador: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promesa,
      new Promise<never>((_, rechazar) => {
        temporizador = setTimeout(() => rechazar(new Error(mensaje)), ms);
      }),
    ]);
  } finally {
    if (temporizador) clearTimeout(temporizador);
  }
}

/**
 * Prueba la configuración de punta a punta SIN emitir ningún comprobante:
 *
 *  1. Abre el certificado y comprueba su vigencia.
 *  2. Firma un XML de prueba EN LOCAL (nunca se envía) para verificar que el
 *     certificado y la clave privada casan.
 *  3. Consulta un ticket inexistente contra el endpoint configurado. SUNAT
 *     responde "el ticket no existe" si las credenciales son correctas, y un
 *     fault 01xx si no lo son. Es la forma estándar de validar el usuario SOL
 *     sin registrar documentos.
 *
 * Nunca lanza por un fallo de SUNAT: devuelve el diagnóstico completo. Solo
 * propaga SunatConfigError cuando ni siquiera hay configuración que probar.
 */
export async function probarConexion(
  organizationId: string,
): Promise<SunatTestResult> {
  // Lo único que no se puede diagnosticar es lo que no existe.
  const row = await getSunatConfigRow(organizationId);
  if (!row) {
    throw new SunatConfigError(MENSAJE_SIN_CONFIGURAR, "SUNAT_NOT_CONFIGURED");
  }

  const certificado = inspeccionarCertificado(row);
  const endpoint = endpointEfectivo(row);

  // A partir de aquí NADA lanza: un certificado roto o unas credenciales
  // erróneas son justo lo que la prueba tiene que contar, no un 500.
  if (!isEncryptionAvailable()) {
    return {
      ok: false,
      ambiente: row.ambiente,
      endpoint,
      habilitado: row.enabled,
      certificado,
      firma: { ok: false, motivo: "Sin SUNAT_ENCRYPTION_KEY no se pueden leer los secretos" },
      conexion: { ok: false, motivo: "No se probó: faltan las credenciales descifradas" },
      credenciales: { ok: false, motivo: "No se probó: faltan las credenciales descifradas" },
      mensaje:
        "El servidor no tiene SUNAT_ENCRYPTION_KEY configurada: no puede leer las credenciales guardadas",
      duracion_ms: 0,
    };
  }
  if (!row.sol_user_enc || !row.sol_pass_enc) {
    return {
      ok: false,
      ambiente: row.ambiente,
      endpoint,
      habilitado: row.enabled,
      certificado,
      firma: { ok: false, motivo: "No se probó: faltan las credenciales SOL" },
      conexion: { ok: false, motivo: "No se probó: faltan las credenciales SOL" },
      credenciales: { ok: false, motivo: "Faltan el usuario o la clave del usuario secundario SOL" },
      mensaje:
        "Faltan el usuario o la clave SOL. Complétalos en Ajustes > SUNAT y vuelve a probar.",
      duracion_ms: 0,
    };
  }

  // 2) Firma local de un documento de prueba. Este XML NO se envía a SUNAT:
  //    solo sirve para comprobar que la clave privada corresponde al certificado.
  const firma: { ok: boolean; motivo?: string } = { ok: false };
  let emisor = emisorDeFila(row);
  try {
    const cargada = await loadSunatConfig(organizationId, db, {
      requireEnabled: false,
    });
    emisor = cargada.emisor;
    const client = cargada.client;
    const { fecha, hora } = fechaHoraLima(new Date());
    const prueba: Comprobante = {
      tipoComprobante: TIPO_COMPROBANTE.FACTURA,
      serie: "F001",
      correlativo: "1",
      fechaEmision: fecha,
      horaEmision: hora,
      moneda: "PEN",
      emisor,
      cliente: {
        tipoDoc: TIPO_DOCUMENTO_IDENTIDAD.RUC,
        numDoc: emisor.ruc,
        razonSocial: emisor.razonSocial,
      },
      detalles: [
        {
          cantidad: 1,
          unidad: UNIDAD_MEDIDA.SERVICIO,
          descripcion: "PRUEBA DE CONFIGURACION (no se envia a SUNAT)",
          valorUnitario: 1,
          precioUnitario: round2(1 + IGV_TASA),
          valorVenta: 1,
          igv: round2(IGV_TASA),
          porcentajeIgv: IGV_TASA * 100,
          tipoAfectacionIgv: TIPO_AFECTACION_IGV.GRAVADO,
        },
      ],
      totales: {
        gravadas: 1,
        igv: round2(IGV_TASA),
        importeTotal: round2(1 + IGV_TASA),
      },
    };
    const firmado = client.firmar(buildInvoiceXml(prueba));
    firma.ok = !!firmado.digestValue;
    if (!firma.ok) firma.motivo = "La firma no produjo un DigestValue válido";
  } catch (err) {
    firma.motivo =
      err instanceof SunatConfigError
        ? err.message
        : `No se pudo firmar con el certificado: ${
            err instanceof Error ? err.message : String(err)
          }`;
  }

  // 3) Consulta contra SUNAT con un ticket inexistente.
  const conexion: { ok: boolean; codigo?: string; motivo?: string } = { ok: false };
  const credenciales: { ok: boolean; codigo?: string; motivo?: string } = { ok: false };

  let usuarioSoap: string;
  let claveSoap: string;
  try {
    usuarioSoap = `${row.ruc}${decryptSecret(row.sol_user_enc)}`;
    claveSoap = decryptSecret(row.sol_pass_enc);
  } catch {
    return {
      ok: false,
      ambiente: row.ambiente,
      endpoint,
      habilitado: row.enabled,
      certificado,
      firma,
      conexion: { ok: false, motivo: "No se probó: las credenciales guardadas no se pudieron descifrar" },
      credenciales: {
        ok: false,
        motivo:
          "Las credenciales guardadas no se pueden descifrar (¿cambió SUNAT_ENCRYPTION_KEY?). Vuelve a introducirlas.",
      },
      mensaje:
        "Las credenciales SOL guardadas no se pueden descifrar. Vuelve a introducirlas en Ajustes > SUNAT.",
      duracion_ms: 0,
    };
  }

  const inicio = Date.now();
  try {
    const estado = await conTiempoLimite(
      getStatus(
        { username: usuarioSoap, password: claveSoap, endpoint },
        "000000000000",
      ),
      20_000,
      "SUNAT no respondió en 20 segundos",
    );
    conexion.ok = true;
    conexion.codigo = estado.statusCode || undefined;
    // Llegó una respuesta de negocio ⇒ el usuario SOL fue aceptado.
    credenciales.ok = true;
  } catch (err) {
    const codigo = err instanceof SunatSoapError ? err.code : undefined;
    const motivo = err instanceof Error ? err.message : String(err);
    // Un error HTTP no es una respuesta de negocio: el servicio está caído o
    // hay un proxy de por medio, no podemos concluir nada de las credenciales.
    const esErrorHttp = /^Error HTTP \d+/.test(motivo);
    if (codigo && CODIGOS_CREDENCIALES.has(codigo)) {
      // SUNAT contestó: hay conexión, lo que falla son las credenciales.
      conexion.ok = true;
      conexion.codigo = codigo;
      credenciales.codigo = codigo;
      credenciales.motivo = `SUNAT rechazó el usuario SOL (${codigo}): ${motivo}`;
    } else if (err instanceof SunatSoapError && !esErrorHttp) {
      // Cualquier otro fault de negocio implica que el login pasó.
      conexion.ok = true;
      conexion.codigo = codigo;
      credenciales.ok = true;
      credenciales.codigo = codigo;
    } else {
      conexion.motivo = `No se pudo contactar con ${endpoint}: ${motivo}`;
      credenciales.motivo = "No se pudieron validar las credenciales sin conexión";
    }
  }
  const duracion_ms = Date.now() - inicio;

  const ok = certificado.valido && firma.ok && conexion.ok && credenciales.ok;
  let mensaje: string;
  if (ok) {
    mensaje = `Conexión correcta con SUNAT (${row.ambiente === "beta" ? "BETA/pruebas" : "PRODUCCIÓN"}). Certificado y usuario SOL válidos.`;
    if (certificado.motivo) mensaje += ` Aviso: ${certificado.motivo}`;
  } else if (!certificado.valido) {
    mensaje = certificado.motivo ?? "El certificado digital no es válido";
  } else if (!firma.ok) {
    mensaje = firma.motivo ?? "No se pudo firmar con el certificado";
  } else if (!conexion.ok) {
    mensaje = conexion.motivo ?? "No hay conexión con SUNAT";
  } else {
    mensaje = credenciales.motivo ?? "Las credenciales SOL no son válidas";
  }

  return {
    ok,
    ambiente: row.ambiente,
    endpoint,
    habilitado: row.enabled,
    certificado,
    firma,
    conexion,
    credenciales,
    mensaje,
    duracion_ms,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Construcción del comprobante
// ───────────────────────────────────────────────────────────────────────────

/**
 * Construye las líneas (detalles) del comprobante a partir de los items de la
 * orden, RECONCILIANDO contra los totales fiscales ya guardados en el invoice
 * (invoice.subtotal = base gravable post-descuento, invoice.igv). Cada línea se
 * prorratea sobre el total con IGV de los items y el residuo de redondeo se
 * ajusta en la última línea, de modo que Σ valorVenta == invoice.subtotal y
 * Σ igv == invoice.igv EXACTAMENTE (SUNAT valida estas sumas con tolerancia de
 * 1 céntimo). Así el comprobante refleja el descuento y cuadra con lo cobrado,
 * en vez de re-derivar cada línea con un /1.18 fijo que no suma al total.
 */
function buildDetalles(items: OrderItemRow[], invoice: InvoiceRow): DetalleItem[] {
  const targetGravadas = round2(invoice.subtotal / 100);
  const targetIgv = round2(invoice.igv / 100);
  const sumConIgv = items.reduce((s, i) => s + i.total, 0); // céntimos
  if (sumConIgv <= 0) return fallbackDetalle(invoice);

  let accVV = 0;
  let accIgv = 0;
  const last = items.length - 1;

  return items.map((item, idx) => {
    // Una cantidad 0 (dato corrupto) haría que valorUnitario fuese Infinity y
    // SUNAT rechazaría el XML entero: se trata como 1 unidad.
    const qty = item.quantity > 0 ? item.quantity : 1;
    let valorVenta: number;
    let igv: number;
    if (idx === last) {
      // La última línea absorbe el residuo para que las sumas cuadren exacto.
      valorVenta = round2(targetGravadas - accVV);
      igv = round2(targetIgv - accIgv);
    } else {
      const share = item.total / sumConIgv;
      valorVenta = round2(targetGravadas * share);
      igv = round2(targetIgv * share);
      accVV = round2(accVV + valorVenta);
      accIgv = round2(accIgv + igv);
    }
    return {
      cantidad: qty,
      unidad: UNIDAD_MEDIDA.UNIDAD,
      descripcion: item.name,
      codigo: item.menu_item_id ?? undefined,
      valorUnitario: round2(valorVenta / qty),
      precioUnitario: round2((valorVenta + igv) / qty),
      valorVenta,
      igv,
      porcentajeIgv: IGV_TASA * 100,
      tipoAfectacionIgv: TIPO_AFECTACION_IGV.GRAVADO,
    };
  });
}

/** Línea única de respaldo cuando la orden no tiene items registrados. */
function fallbackDetalle(invoice: InvoiceRow): DetalleItem[] {
  const valorVenta = round2(invoice.subtotal / 100);
  const igv = round2(invoice.igv / 100);
  return [
    {
      cantidad: 1,
      unidad: UNIDAD_MEDIDA.SERVICIO,
      descripcion: "Consumo",
      valorUnitario: valorVenta,
      // El precio unitario es el precio CON IGV de ESTA línea, no el total del
      // comprobante: si la orden lleva delivery, ese cargo va en su propia línea.
      precioUnitario: round2(valorVenta + igv),
      valorVenta,
      igv,
      porcentajeIgv: IGV_TASA * 100,
      tipoAfectacionIgv: TIPO_AFECTACION_IGV.GRAVADO,
    },
  ];
}

/**
 * Línea que recoge la diferencia entre el importe realmente cobrado
 * (invoice.total) y la base + IGV de los productos (invoice.subtotal +
 * invoice.igv). En la práctica esa diferencia es el DELIVERY: la orden lo suma
 * al total pero no lo mete en la base imponible.
 *
 * Sin esta línea el importeTotal declarado a SUNAT era menor que lo cobrado
 * (sub-declaración fiscal) y el comprobante no cuadraba con invoices.total.
 * El cargo se trata como servicio gravado con el precio CON IGV incluido, que
 * es como se le cobra al comensal.
 */
function detalleDiferencia(diferencia: number): DetalleItem {
  const valorVenta = round2(diferencia / (1 + IGV_TASA));
  const igv = round2(diferencia - valorVenta);
  return {
    cantidad: 1,
    unidad: UNIDAD_MEDIDA.SERVICIO,
    descripcion: "Servicio de entrega (delivery)",
    valorUnitario: valorVenta,
    precioUnitario: round2(valorVenta + igv),
    valorVenta,
    igv,
    porcentajeIgv: IGV_TASA * 100,
    tipoAfectacionIgv: TIPO_AFECTACION_IGV.GRAVADO,
  };
}

function totalesDeDetalles(detalles: DetalleItem[]): Totales {
  const gravadas = round2(detalles.reduce((s, d) => s + d.valorVenta, 0));
  const igv = round2(detalles.reduce((s, d) => s + d.igv, 0));
  return { gravadas, igv, importeTotal: round2(gravadas + igv) };
}

function fechaHoraLima(date: Date): { fecha: string; hora: string } {
  // Lima es UTC-5 sin DST
  const lima = new Date(date.getTime() - 5 * 60 * 60 * 1000);
  const fecha = lima.toISOString().slice(0, 10);
  const hora = lima.toISOString().slice(11, 19);
  return { fecha, hora };
}

/** Mapea un comprobante de la BD a la estructura UBL del paquete SUNAT. */
async function buildComprobante(
  invoice: InvoiceRow,
  emisor: Emisor,
  conn: DbOrTx,
): Promise<Comprobante> {
  const items = await conn
    .select()
    .from(schema.orderItems)
    .where(eq(schema.orderItems.order_id, invoice.order_id));

  const detalles = items.length ? buildDetalles(items, invoice) : fallbackDetalle(invoice);

  // El importe declarado tiene que ser EXACTAMENTE lo cobrado (invoice.total).
  // Todo lo que el total lleve por encima de base + IGV (típicamente el
  // delivery) se declara en su propia línea gravada.
  const totalDocumento = round2(invoice.total / 100);
  const baseProductos = round2(invoice.subtotal / 100);
  const igvProductos = round2(invoice.igv / 100);
  const diferencia = round2(totalDocumento - baseProductos - igvProductos);

  if (diferencia < -TOLERANCIA) {
    throw new SunatDocumentError(
      `El comprobante ${invoice.series}-${invoice.number} está descuadrado: la base más el IGV (S/ ${(
        baseProductos + igvProductos
      ).toFixed(2)}) superan el total cobrado (S/ ${totalDocumento.toFixed(2)}). Corrígelo antes de declararlo.`,
      "INVOICE_TOTALS_MISMATCH",
    );
  }
  if (diferencia > TOLERANCIA) {
    detalles.push(detalleDiferencia(diferencia));
  }

  const totales = totalesDeDetalles(detalles);
  const { fecha, hora } = fechaHoraLima(invoice.created_at);

  return {
    tipoComprobante: mapTipoComprobante(invoice.type),
    serie: invoice.series,
    correlativo: String(invoice.number),
    fechaEmision: fecha,
    horaEmision: hora,
    moneda: "PEN",
    emisor,
    cliente: {
      tipoDoc: mapDocType(invoice.customer_doc_type),
      numDoc: invoice.customer_doc_number,
      razonSocial: invoice.customer_name,
    },
    detalles,
    totales,
    leyendas: [{ codigo: "1000", valor: montoEnLetras(totales.importeTotal, "PEN") }],
  };
}

/** Reconstruye una nota de crédito ya persistida (para poder reenviarla). */
async function buildNotaDesdeFila(
  nota: InvoiceRow,
  emisor: Emisor,
  conn: DbOrTx,
): Promise<Nota> {
  if (!nota.reference_invoice_id) {
    throw new SunatDocumentError(
      "La nota de crédito no tiene comprobante de referencia: no se puede reconstruir su XML",
      "NOTE_WITHOUT_REFERENCE",
    );
  }
  const [referencia] = await conn
    .select()
    .from(schema.invoices)
    .where(eq(schema.invoices.id, nota.reference_invoice_id))
    .limit(1);

  if (!referencia) {
    throw new SunatDocumentError(
      "El comprobante afectado por la nota de crédito ya no existe",
      "NOTE_REFERENCE_MISSING",
    );
  }

  const base = await buildComprobante(referencia, emisor, conn);
  return {
    ...base,
    tipoComprobante: TIPO_COMPROBANTE.NOTA_CREDITO,
    serie: nota.series,
    correlativo: String(nota.number),
    codigoMotivo: nota.note_motive_code ?? "01",
    descripcionMotivo:
      nota.note_motive_description ?? "Anulación de la operación",
    documentoAfectado: {
      tipoDoc: mapTipoComprobante(referencia.type),
      serieNumero: `${referencia.series}-${referencia.number}`,
    },
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Persistencia del resultado
// ───────────────────────────────────────────────────────────────────────────

/** Estados que ya son definitivos y que un reintento no puede degradar. */
const ESTADOS_FINALES = new Set(["accepted", "observed", "voided"]);

/** Persiste el resultado de SUNAT en la fila del comprobante. */
async function persistResult(
  invoiceId: string,
  result: SunatResult,
  conn: DbOrTx,
): Promise<void> {
  // Idempotencia: un reenvío (o una carrera) que vuelva con "ya presentado" no
  // puede pisar un resultado aceptado/observado/anulado ni perder su CDR.
  const [current] = await conn
    .select({ s: schema.invoices.sunat_status })
    .from(schema.invoices)
    .where(eq(schema.invoices.id, invoiceId))
    .limit(1);
  if (current && ESTADOS_FINALES.has(current.s)) return;

  const codigo = result.codigo ?? "";
  // SUNAT 1033 = "el comprobante ya fue presentado": el documento SÍ está
  // registrado, así que un envío duplicado se trata como aceptado (idempotente),
  // no como un error reintentable.
  const yaPresentado =
    codigo === "1033" ||
    /ya (fue|ha sido|est[áa]) (presentad|registrad)/i.test(result.descripcion ?? "");

  let status: typeof schema.invoices.$inferInsert.sunat_status;
  if (result.ticket && !result.cdrXml) {
    status = "sent";
  } else if (result.exito) {
    status = result.notas && result.notas.length ? "observed" : "accepted";
  } else if (yaPresentado) {
    status = "accepted";
  } else if (codigo && /^[23]\d{3}$/.test(codigo)) {
    // 2xxx/3xxx = rechazo definitivo del documento. (1xxx suelen ser
    // transitorios/reintentables y 4xxx son observaciones → quedan como 'error'
    // hasta que un reintento aclare el estado.)
    status = "rejected";
  } else {
    status = "error";
  }

  await conn
    .update(schema.invoices)
    .set({
      sunat_status: status,
      sunat_code: result.codigo ?? null,
      sunat_description: result.descripcion ?? null,
      sunat_ticket: result.ticket ?? null,
      sunat_hash: result.hash ?? null,
      xml_signed: result.xmlFirmado ?? null,
      cdr_xml: result.cdrXml ?? null,
      sunat_response: result as any,
      sent_at: new Date(),
    })
    .where(eq(schema.invoices.id, invoiceId));
}

/**
 * Marca un comprobante como dado de baja CONSERVANDO su rastro fiscal.
 *
 * Un comprobante aceptado guarda el código, el ticket y el CDR con los que
 * SUNAT lo admitió; ese rastro es la prueba de la emisión y debe sobrevivir a
 * la anulación (la baja se documenta aparte, en `sunat_description` y en la
 * traza de auditoría). Solo se sobrescriben los campos cuando la anulación en
 * sí trae respuesta de SUNAT.
 *
 * El UPDATE va condicionado a que la fila no esté ya anulada, de modo que dos
 * anulaciones simultáneas no se pisen la descripción.
 */
async function marcarAnulado(
  invoiceId: string,
  descripcion: string,
  result: SunatResult | null,
  conn: DbOrTx,
): Promise<void> {
  const set: Partial<typeof schema.invoices.$inferInsert> = {
    sunat_status: "voided",
    sunat_description: descripcion,
    sent_at: new Date(),
  };
  if (result) {
    if (result.codigo !== undefined) set.sunat_code = result.codigo;
    if (result.ticket) set.sunat_ticket = result.ticket;
    set.sunat_response = result as any;
  }

  await conn
    .update(schema.invoices)
    .set(set)
    .where(
      and(
        eq(schema.invoices.id, invoiceId),
        ne(schema.invoices.sunat_status, "voided"),
      ),
    );
}

// ───────────────────────────────────────────────────────────────────────────
// Emisión
// ───────────────────────────────────────────────────────────────────────────

/** Declara (envía) una factura, boleta o nota de crédito a SUNAT. */
export async function declararComprobante(
  invoice: InvoiceRow,
  organizationId: string,
): Promise<SunatResult> {
  const { client, emisor } = await loadSunatConfig(organizationId);

  if (invoice.type === "nota_credito") {
    const nota = await buildNotaDesdeFila(invoice, emisor, db);
    const result = await client.enviarNotaCredito(nota);
    await persistResult(invoice.id, result, db);
    return result;
  }
  if (invoice.type === "nota_debito") {
    throw new SunatDocumentError(
      "Las notas de débito todavía no se emiten desde el sistema",
      "NOTE_TYPE_UNSUPPORTED",
    );
  }

  const comprobante = await buildComprobante(invoice, emisor, db);
  const result = await client.enviarComprobante(comprobante);
  await persistResult(invoice.id, result, db);
  return result;
}

/**
 * Reenvía un comprobante que quedó a medias. Elige solo: si hay ticket
 * pendiente consulta el estado (no hay nada que reenviar, hay que esperar a
 * SUNAT); si no, vuelve a declararlo.
 */
export async function reenviarComprobante(
  invoice: InvoiceRow,
  organizationId: string,
): Promise<{ accion: "consulta_ticket" | "reenvio"; result: SunatResult }> {
  if (ESTADOS_FINALES.has(invoice.sunat_status)) {
    throw new SunatDocumentError(
      invoice.sunat_status === "voided"
        ? "El comprobante ya fue dado de baja"
        : "El comprobante ya fue aceptado por SUNAT: no hace falta reenviarlo",
      invoice.sunat_status === "voided"
        ? "INVOICE_ALREADY_VOIDED"
        : "INVOICE_ALREADY_ACCEPTED",
    );
  }

  if (invoice.sunat_ticket) {
    const result = await consultarEstado(invoice, organizationId);
    return { accion: "consulta_ticket", result };
  }

  const result = await declararComprobante(invoice, organizationId);
  return { accion: "reenvio", result };
}

/** Consulta el estado en SUNAT de un comprobante con ticket asíncrono. */
export async function consultarEstado(
  invoice: InvoiceRow,
  organizationId: string,
): Promise<SunatResult> {
  if (!invoice.sunat_ticket) {
    // Sin ticket: devolver el estado almacenado
    return {
      exito: invoice.sunat_status === "accepted",
      codigo: invoice.sunat_code ?? undefined,
      descripcion: invoice.sunat_description ?? invoice.sunat_status,
    };
  }
  const { client } = await loadSunatConfig(organizationId);
  const result = await client.consultarTicket(invoice.sunat_ticket);
  if (result.cdrXml || result.codigo === "0") {
    await persistResult(invoice.id, result, db);
  }
  return result;
}

/** Reserva el siguiente correlativo de una serie, reintentando si hay carrera. */
async function crearFilaNota(params: {
  referencia: InvoiceRow;
  organizationId: string;
  branchId: string;
  serie: string;
  motivoCodigo: string;
  motivoDescripcion: string;
}): Promise<InvoiceRow> {
  const MAX_INTENTOS = 5;
  for (let intento = 0; intento < MAX_INTENTOS; intento++) {
    try {
      return await db.transaction(async (tx) => {
        const [last] = await tx
          .select({ number: schema.invoices.number })
          .from(schema.invoices)
          .where(
            and(
              eq(schema.invoices.branch_id, params.branchId),
              eq(schema.invoices.series, params.serie),
            ),
          )
          .orderBy(desc(schema.invoices.number))
          .limit(1)
          .for("update");

        const [created] = await tx
          .insert(schema.invoices)
          .values({
            order_id: params.referencia.order_id,
            organization_id: params.organizationId,
            branch_id: params.branchId,
            type: "nota_credito",
            series: params.serie,
            number: (last?.number ?? 0) + 1,
            customer_name: params.referencia.customer_name,
            customer_doc_type: params.referencia.customer_doc_type,
            customer_doc_number: params.referencia.customer_doc_number,
            subtotal: params.referencia.subtotal,
            igv: params.referencia.igv,
            total: params.referencia.total,
            sunat_status: "pending",
            reference_invoice_id: params.referencia.id,
            note_motive_code: params.motivoCodigo,
            note_motive_description: params.motivoDescripcion,
          })
          .returning();
        return created!;
      });
    } catch (err: any) {
      // 23505 = unique_violation sobre (branch, serie, número): otro proceso se
      // llevó el correlativo. Se recalcula y se reintenta.
      const code = err?.code ?? err?.cause?.code;
      if (code === "23505" && intento < MAX_INTENTOS - 1) continue;
      throw err;
    }
  }
  throw new SunatDocumentError(
    "No se pudo reservar el número de la nota de crédito, inténtalo de nuevo",
    "NOTE_NUMBER_CONFLICT",
  );
}

/** Emite y envía una nota de crédito que referencia a un comprobante existente. */
export async function emitirNotaCredito(
  referencia: InvoiceRow,
  params: {
    organizationId: string;
    branchId: string;
    motivoCodigo: string;
    motivoDescripcion: string;
  },
): Promise<{ result: SunatResult; nota: InvoiceRow }> {
  const { client, emisor } = await loadSunatConfig(params.organizationId);
  const series = await loadSeries(params.branchId);

  const nota = await crearFilaNota({
    referencia,
    organizationId: params.organizationId,
    branchId: params.branchId,
    serie: serieNotaCredito(referencia.type, series),
    motivoCodigo: params.motivoCodigo,
    motivoDescripcion: params.motivoDescripcion,
  });

  const base = await buildComprobante(referencia, emisor, db);
  const notaDoc: Nota = {
    ...base,
    tipoComprobante: TIPO_COMPROBANTE.NOTA_CREDITO,
    serie: nota.series,
    correlativo: String(nota.number),
    codigoMotivo: params.motivoCodigo,
    descripcionMotivo: params.motivoDescripcion,
    documentoAfectado: {
      tipoDoc: mapTipoComprobante(referencia.type),
      serieNumero: `${referencia.series}-${referencia.number}`,
    },
  };

  const result = await client.enviarNotaCredito(notaDoc);
  await persistResult(nota.id, result, db);

  const [notaActualizada] = await db
    .select()
    .from(schema.invoices)
    .where(eq(schema.invoices.id, nota.id))
    .limit(1);

  return { result, nota: notaActualizada ?? nota };
}

/**
 * Correlativo del siguiente RA (comunicación de baja) del día.
 *
 * SUNAT solo exige que el par (RUC, fecha, correlativo) sea único; los huecos
 * están permitidos. Se cuenta cuántos comprobantes de la organización se
 * anularon hoy y se suma uno.
 */
async function siguienteCorrelativoBaja(
  organizationId: string,
  fechaCivil: string,
  conn: DbOrTx = db,
): Promise<number> {
  const [row] = await conn
    .select({ n: count() })
    .from(schema.invoices)
    .where(
      and(
        eq(schema.invoices.organization_id, organizationId),
        eq(schema.invoices.sunat_status, "voided"),
        gte(schema.invoices.sent_at, peruCivilDayStart(fechaCivil)),
        lt(schema.invoices.sent_at, peruCivilDayEnd(fechaCivil)),
      ),
    );
  return Number(row?.n ?? 0) + 1;
}

/** Genera y envía la comunicación de baja de una factura aceptada. */
export async function comunicarBaja(
  invoice: InvoiceRow,
  params: { organizationId: string; motivo: string; correlativo?: number },
): Promise<SunatResult> {
  const { client, emisor } = await loadSunatConfig(params.organizationId);
  const { fecha } = fechaHoraLima(new Date());
  const { fecha: fechaDoc } = fechaHoraLima(invoice.created_at);
  const correlativo =
    params.correlativo ??
    (await siguienteCorrelativoBaja(params.organizationId, fecha));

  const baja: ComunicacionBaja = {
    emisor,
    fechaGeneracion: fecha,
    fechaEmisionDocumentos: fechaDoc,
    correlativo,
    items: [
      {
        tipoComprobante: mapTipoComprobante(invoice.type),
        serie: invoice.series,
        correlativo: String(invoice.number),
        motivo: params.motivo,
      },
    ],
  };

  const result = await client.enviarBaja(baja);

  if (result.exito && result.ticket) {
    // La baja es asíncrona: SUNAT devuelve un ticket. Operativamente el
    // comprobante YA está anulado para el local, así que se marca 'voided' y se
    // guarda el ticket para poder confirmarlo con GET /:id/estado.
    await marcarAnulado(
      invoice.id,
      `Comunicación de baja RA-${fecha.replace(/-/g, "")}-${correlativo} enviada (ticket ${result.ticket}). Motivo: ${params.motivo}`,
      result,
      db,
    );
  } else {
    // Falló el envío: NO se toca el estado del comprobante (sigue aceptado).
    logger.warn("La comunicación de baja no fue aceptada por SUNAT", {
      invoiceId: invoice.id,
      codigo: result.codigo,
      descripcion: result.descripcion,
    });
  }

  return result;
}

/** Días naturales transcurridos entre la emisión y hoy, en calendario peruano. */
function diasDesdeEmision(invoice: InvoiceRow): number {
  const emision = peruCivilDayStart(peruCivilDate(invoice.created_at));
  const hoy = peruCivilDayStart(peruCivilDate(new Date()));
  return Math.round((hoy.getTime() - emision.getTime()) / 86_400_000);
}

/**
 * Plazo de SUNAT para la comunicación de baja de una factura: hasta el séptimo
 * día calendario siguiente a la fecha de emisión. Pasado ese plazo la única vía
 * es la nota de crédito.
 */
const PLAZO_BAJA_DIAS = 7;

export type ViaAnulacion = "baja" | "nota_credito" | "local";

export interface ResultadoAnulacion {
  via: ViaAnulacion;
  /** Explicación de por qué se eligió esa vía (para la UI y la auditoría). */
  motivo_via: string;
  result?: SunatResult;
  /** Nota de crédito generada, si la vía fue nota_credito. */
  nota?: InvoiceRow;
  /** Fila del comprobante ya actualizada. */
  invoice: InvoiceRow;
}

/**
 * Anula un comprobante eligiendo el mecanismo que corresponde:
 *
 * - Factura aceptada dentro del plazo → COMUNICACIÓN DE BAJA (RA).
 * - Factura fuera de plazo o boleta aceptada → NOTA DE CRÉDITO (motivo 01).
 *   Las boletas no se dan de baja con un RA: se anulan por nota de crédito o
 *   informándolas con estado 3 en el resumen diario.
 * - Comprobante que nunca llegó a SUNAT (pending/error/rejected) → anulación
 *   LOCAL: no hay nada que comunicar porque SUNAT no lo tiene registrado.
 */
export async function anularComprobante(
  invoiceEntrada: InvoiceRow,
  params: {
    organizationId: string;
    branchId: string;
    motivo: string;
    /** Fuerza la vía; por defecto se decide automáticamente. */
    via?: ViaAnulacion;
    correlativo?: number;
  },
): Promise<ResultadoAnulacion> {
  // La fila que trae la ruta se leyó ANTES de validar nada: si entre esa
  // lectura y esta llamada otra petición ya anuló el comprobante (doble clic en
  // "Anular"), se emitirían dos notas de crédito sobre la misma venta. Se
  // reelee bloqueando la fila y se valida sobre el estado real.
  const { invoice, anuladoEnLocal } = await db.transaction(async (tx) => {
    const [fresco] = await tx
      .select()
      .from(schema.invoices)
      .where(
        and(
          eq(schema.invoices.id, invoiceEntrada.id),
          // Acotado a la organización también aquí: el servicio no debe poder
          // anular un comprobante ajeno aunque quien lo llame se equivoque.
          eq(schema.invoices.organization_id, params.organizationId),
        ),
      )
      .limit(1)
      .for("update");

    if (!fresco) {
      throw new SunatDocumentError(
        "El comprobante ya no existe",
        "INVOICE_NOT_FOUND",
      );
    }
    if (fresco.type === "nota_credito" || fresco.type === "nota_debito") {
      throw new SunatDocumentError(
        "Una nota de crédito o débito no se anula: emite el documento que corrija su efecto",
        "INVOICE_TYPE_NOT_VOIDABLE",
      );
    }
    if (fresco.sunat_status === "voided") {
      throw new SunatDocumentError(
        "El comprobante ya está anulado",
        "INVOICE_ALREADY_VOIDED",
      );
    }
    if (fresco.sunat_status === "sent") {
      throw new SunatDocumentError(
        "El comprobante está pendiente de respuesta de SUNAT. Consulta su estado antes de anularlo.",
        "INVOICE_PENDING_TICKET",
      );
    }

    const declarado =
      fresco.sunat_status === "accepted" || fresco.sunat_status === "observed";

    // ── Nunca llegó a SUNAT: se anula solo en el sistema ────────────────
    // Se ignora `via` a propósito: no se puede comunicar la baja ni emitir una
    // nota de crédito sobre un documento que SUNAT nunca registró. Como no hay
    // llamada de red, la baja se hace DENTRO del bloqueo y queda atómica.
    if (!declarado) {
      await marcarAnulado(
        fresco.id,
        `Anulado en el sistema (nunca fue aceptado por SUNAT). Motivo: ${params.motivo}`,
        null,
        tx,
      );
      return { invoice: fresco, anuladoEnLocal: true };
    }

    return { invoice: fresco, anuladoEnLocal: false };
  });

  if (anuladoEnLocal) {
    return {
      via: "local",
      motivo_via:
        "El comprobante no llegó a estar aceptado por SUNAT, así que no hay nada que comunicar: se anula solo en el sistema.",
      invoice: await recargarInvoice(invoice.id),
    };
  }

  const dias = diasDesdeEmision(invoice);
  const viaAutomatica: ViaAnulacion =
    invoice.type === "factura" && dias <= PLAZO_BAJA_DIAS ? "baja" : "nota_credito";
  const via = params.via && params.via !== "local" ? params.via : viaAutomatica;

  if (via === "baja") {
    if (invoice.type !== "factura") {
      throw new SunatDocumentError(
        "Las boletas no admiten comunicación de baja: se anulan por nota de crédito",
        "VOID_METHOD_NOT_ALLOWED",
      );
    }
    if (dias > PLAZO_BAJA_DIAS) {
      // Forzar `via=baja` fuera de plazo produce un RA que SUNAT rechaza y deja
      // la venta sin anular: se corta aquí con la alternativa correcta.
      throw new SunatDocumentError(
        `La factura se emitió hace ${dias} día(s) y el plazo de comunicación de baja es de ${PLAZO_BAJA_DIAS} días. Anúlala con una nota de crédito.`,
        "VOID_METHOD_NOT_ALLOWED",
      );
    }
    const result = await comunicarBaja(invoice, {
      organizationId: params.organizationId,
      motivo: params.motivo,
      correlativo: params.correlativo,
    });
    return {
      via: "baja",
      motivo_via: `Factura emitida hace ${dias} día(s): dentro del plazo de ${PLAZO_BAJA_DIAS} días para la comunicación de baja.`,
      result,
      invoice: await recargarInvoice(invoice.id),
    };
  }

  // ── Nota de crédito ───────────────────────────────────────────────────
  const { result, nota } = await emitirNotaCredito(invoice, {
    organizationId: params.organizationId,
    branchId: params.branchId,
    motivoCodigo: "01", // Catálogo 09: anulación de la operación
    motivoDescripcion: params.motivo,
  });

  if (result.exito) {
    await marcarAnulado(
      invoice.id,
      `Anulado con la nota de crédito ${nota.series}-${nota.number}. Motivo: ${params.motivo}`,
      null,
      db,
    );
  }

  return {
    via: "nota_credito",
    motivo_via:
      invoice.type === "boleta"
        ? "Las boletas se anulan emitiendo una nota de crédito."
        : `La factura se emitió hace ${dias} día(s): fuera del plazo de ${PLAZO_BAJA_DIAS} días para la comunicación de baja.`,
    result,
    nota,
    invoice: await recargarInvoice(invoice.id),
  };
}

async function recargarInvoice(id: string): Promise<InvoiceRow> {
  const [row] = await db
    .select()
    .from(schema.invoices)
    .where(eq(schema.invoices.id, id))
    .limit(1);
  return row!;
}

/**
 * Genera y envía el resumen diario de las boletas de una fecha.
 * Devuelve el resultado (con ticket) y los IDs de las boletas incluidas.
 */
export async function enviarResumenDiario(params: {
  organizationId: string;
  branchId: string;
  fecha: string; // YYYY-MM-DD (fecha civil peruana de emisión de las boletas)
  correlativo: number;
}): Promise<{ result: SunatResult; invoiceIds: string[] }> {
  const { client, emisor } = await loadSunatConfig(params.organizationId);

  const inicio = peruCivilDayStart(params.fecha);
  const fin = peruCivilDayEnd(params.fecha); // exclusivo

  const boletas = await db
    .select()
    .from(schema.invoices)
    .where(
      and(
        eq(schema.invoices.organization_id, params.organizationId),
        eq(schema.invoices.branch_id, params.branchId),
        eq(schema.invoices.type, "boleta"),
        eq(schema.invoices.sunat_status, "pending"),
        gte(schema.invoices.created_at, inicio),
        lt(schema.invoices.created_at, fin),
      ),
    );

  if (boletas.length === 0) {
    return {
      result: {
        exito: false,
        descripcion: "No hay boletas pendientes para la fecha indicada",
      },
      invoiceIds: [],
    };
  }

  const items: ResumenDiarioItem[] = await Promise.all(
    boletas.map(async (b) => {
      const comp = await buildComprobante(b, emisor, db);
      return {
        tipoComprobante: TIPO_COMPROBANTE.BOLETA,
        serie: b.series,
        correlativo: String(b.number),
        estado: "1",
        moneda: "PEN",
        cliente: comp.cliente,
        totales: comp.totales,
      } satisfies ResumenDiarioItem;
    }),
  );

  const { fecha: hoy } = fechaHoraLima(new Date());
  const resumen: ResumenDiario = {
    emisor,
    fechaGeneracion: hoy,
    fechaEmisionDocumentos: params.fecha,
    correlativo: params.correlativo,
    items,
  };

  const result = await client.enviarResumen(resumen);

  // Marcar las boletas como enviadas con el mismo ticket. El UPDATE se acota a
  // las que SIGUEN en 'pending': si mientras se enviaba el resumen otra
  // petición ya las declaró (o alguien las anuló), su estado no se degrada.
  if (result.ticket) {
    await db
      .update(schema.invoices)
      .set({
        sunat_status: "sent",
        sunat_ticket: result.ticket,
        sent_at: new Date(),
      })
      .where(
        and(
          inArray(
            schema.invoices.id,
            boletas.map((b) => b.id),
          ),
          eq(schema.invoices.sunat_status, "pending"),
        ),
      );
  }

  return { result, invoiceIds: boletas.map((b) => b.id) };
}
