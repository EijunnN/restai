import { and, eq, gte, lte, inArray, desc } from "drizzle-orm";
import { db, schema, type DbOrTx } from "@restai/db";
import {
  SunatClient,
  pfxToPem,
  mapDocType,
  mapTipoComprobante,
  montoEnLetras,
  IGV_TASA,
  TIPO_AFECTACION_IGV,
  TIPO_COMPROBANTE,
  UNIDAD_MEDIDA,
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
import { decryptSecret } from "../lib/crypto.js";

type InvoiceRow = typeof schema.invoices.$inferSelect;
type OrderRow = typeof schema.orders.$inferSelect;
type OrderItemRow = typeof schema.orderItems.$inferSelect;
type SunatConfigRow = typeof schema.sunatConfig.$inferSelect;

export class SunatConfigError extends Error {}

const round2 = (x: number) => Math.round(x * 100) / 100;

/** Carga y descifra la configuración SUNAT de una organización. */
export async function loadSunatConfig(
  organizationId: string,
  conn: DbOrTx = db,
): Promise<{ row: SunatConfigRow; client: SunatClient; emisor: Emisor }> {
  const [row] = await conn
    .select()
    .from(schema.sunatConfig)
    .where(eq(schema.sunatConfig.organization_id, organizationId))
    .limit(1);

  if (!row) {
    throw new SunatConfigError(
      "No hay configuración SUNAT para esta organización. Configúrala en /api/sunat/config",
    );
  }
  if (!row.enabled) {
    throw new SunatConfigError("La facturación electrónica SUNAT está deshabilitada");
  }
  if (!row.sol_user_enc || !row.sol_pass_enc || !row.cert_enc) {
    throw new SunatConfigError(
      "Faltan credenciales SOL o el certificado digital en la configuración SUNAT",
    );
  }

  const emisor: Emisor = {
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

  // Resolver certificado a PEM
  const certDecrypted = decryptSecret(row.cert_enc);
  let certificadoPem: string;
  let llavePrivadaPem: string | undefined;
  if (row.cert_format === "pem") {
    certificadoPem = certDecrypted;
  } else {
    const pass = row.cert_pass_enc ? decryptSecret(row.cert_pass_enc) : "";
    const keys = pfxToPem(certDecrypted, pass);
    certificadoPem = keys.certificatePem;
    llavePrivadaPem = keys.privateKeyPem;
  }

  const clientConfig: SunatClientConfig = {
    ambiente: row.ambiente,
    usuarioSol: decryptSecret(row.sol_user_enc),
    claveSol: decryptSecret(row.sol_pass_enc),
    certificadoPem,
    llavePrivadaPem,
    emisor,
    endpointOverride: row.endpoint_override ?? undefined,
  };

  return { row, client: new SunatClient(clientConfig), emisor };
}

/** Construye las líneas (detalles) del comprobante a partir de los items de la orden. */
function buildDetalles(items: OrderItemRow[]): DetalleItem[] {
  return items.map((item) => {
    const qty = item.quantity;
    const lineTotalConIgv = item.total / 100;
    const valorVenta = round2(lineTotalConIgv / (1 + IGV_TASA));
    const igv = round2(valorVenta * IGV_TASA);
    return {
      cantidad: qty,
      unidad: UNIDAD_MEDIDA.UNIDAD,
      descripcion: item.name,
      codigo: item.menu_item_id ?? undefined,
      valorUnitario: round2(valorVenta / qty),
      precioUnitario: round2(lineTotalConIgv / qty),
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
      precioUnitario: round2(invoice.total / 100),
      valorVenta,
      igv,
      porcentajeIgv: IGV_TASA * 100,
      tipoAfectacionIgv: TIPO_AFECTACION_IGV.GRAVADO,
    },
  ];
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

  const detalles = items.length ? buildDetalles(items) : fallbackDetalle(invoice);
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
    leyendas: [
      { codigo: "1000", valor: montoEnLetras(totales.importeTotal, "PEN") },
    ],
  };
}

/** Persiste el resultado de SUNAT en la fila del comprobante. */
async function persistResult(
  invoiceId: string,
  result: SunatResult,
  conn: DbOrTx,
): Promise<void> {
  let status: typeof schema.invoices.$inferInsert.sunat_status;
  if (result.ticket && !result.cdrXml) {
    status = "sent";
  } else if (result.exito) {
    status = result.notas && result.notas.length ? "observed" : "accepted";
  } else if (result.codigo && /^[23]\d{3}$/.test(result.codigo)) {
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

/** Declara (envía) una factura o boleta a SUNAT y actualiza la fila. */
export async function declararComprobante(
  invoice: InvoiceRow,
  organizationId: string,
): Promise<SunatResult> {
  const { client, emisor } = await loadSunatConfig(organizationId);
  const comprobante = await buildComprobante(invoice, emisor, db);
  const result = await client.enviarComprobante(comprobante);
  await persistResult(invoice.id, result, db);
  return result;
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

  const serieNota = `${referencia.type === "factura" ? "FC" : "BC"}01`;

  const nota = await db.transaction(async (tx) => {
    const [last] = await tx
      .select({ number: schema.invoices.number })
      .from(schema.invoices)
      .where(
        and(
          eq(schema.invoices.branch_id, params.branchId),
          eq(schema.invoices.series, serieNota),
        ),
      )
      .orderBy(desc(schema.invoices.number))
      .limit(1)
      .for("update");

    const nextNumber = (last?.number ?? 0) + 1;

    const [created] = await tx
      .insert(schema.invoices)
      .values({
        order_id: referencia.order_id,
        organization_id: params.organizationId,
        branch_id: params.branchId,
        type: "nota_credito",
        series: serieNota,
        number: nextNumber,
        customer_name: referencia.customer_name,
        customer_doc_type: referencia.customer_doc_type,
        customer_doc_number: referencia.customer_doc_number,
        subtotal: referencia.subtotal,
        igv: referencia.igv,
        total: referencia.total,
        sunat_status: "pending",
        reference_invoice_id: referencia.id,
        note_motive_code: params.motivoCodigo,
        note_motive_description: params.motivoDescripcion,
      })
      .returning();
    return created!;
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
  return { result, nota };
}

/** Genera y envía la comunicación de baja de una factura aceptada. */
export async function comunicarBaja(
  invoice: InvoiceRow,
  params: { organizationId: string; motivo: string; correlativo: number },
): Promise<SunatResult> {
  const { client, emisor } = await loadSunatConfig(params.organizationId);
  const { fecha } = fechaHoraLima(new Date());
  const { fecha: fechaDoc } = fechaHoraLima(invoice.created_at);

  const baja: ComunicacionBaja = {
    emisor,
    fechaGeneracion: fecha,
    fechaEmisionDocumentos: fechaDoc,
    correlativo: params.correlativo,
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
  await persistResult(invoice.id, result, db);
  return result;
}

/**
 * Genera y envía el resumen diario de las boletas de una fecha.
 * Devuelve el resultado (con ticket) y los IDs de las boletas incluidas.
 */
export async function enviarResumenDiario(params: {
  organizationId: string;
  branchId: string;
  fecha: string; // YYYY-MM-DD (fecha de emisión de las boletas)
  correlativo: number;
}): Promise<{ result: SunatResult; invoiceIds: string[] }> {
  const { client, emisor } = await loadSunatConfig(params.organizationId);

  const start = new Date(`${params.fecha}T00:00:00.000-05:00`);
  const end = new Date(`${params.fecha}T23:59:59.999-05:00`);

  const boletas = await db
    .select()
    .from(schema.invoices)
    .where(
      and(
        eq(schema.invoices.branch_id, params.branchId),
        eq(schema.invoices.type, "boleta"),
        eq(schema.invoices.sunat_status, "pending"),
        gte(schema.invoices.created_at, start),
        lte(schema.invoices.created_at, end),
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

  // Marcar las boletas como enviadas con el mismo ticket
  if (result.ticket) {
    await db
      .update(schema.invoices)
      .set({
        sunat_status: "sent",
        sunat_ticket: result.ticket,
        sent_at: new Date(),
      })
      .where(
        inArray(
          schema.invoices.id,
          boletas.map((b) => b.id),
        ),
      );
  }

  return { result, invoiceIds: boletas.map((b) => b.id) };
}
