# Integración SUNAT — Facturación Electrónica

RestAI emite comprobantes de pago electrónicos (CPE) y los declara directamente
ante SUNAT mediante su servicio web SOAP, sin depender de un OSE/PSE.

## Qué incluye

| Documento | Catálogo 01 | Cómo se declara |
|-----------|-------------|-----------------|
| Factura | `01` | Envío síncrono (`sendBill`) → CDR inmediato |
| Boleta de venta | `03` | Resumen diario (`sendSummary`) → ticket |
| Nota de crédito | `07` | Envío síncrono (`sendBill`) → CDR inmediato |
| Comunicación de baja | `RA` | Asíncrono (`sendSummary`) → ticket |

El flujo completo por comprobante: **construir XML UBL 2.1 → firmar (XML-DSig)
→ comprimir (ZIP) → enviar (SOAP) → leer el CDR**.

Todo el protocolo vive en el paquete [`@restai/sunat`](../packages/sunat); la
API solo mapea los datos de la BD y persiste la respuesta.

## Arquitectura

```
packages/sunat/                 # Protocolo SUNAT (sin acoplar a la BD)
├── ubl/                        # Constructores de XML UBL 2.1
│   ├── invoice.ts              #   Factura / Boleta
│   ├── credit-note.ts          #   Nota de crédito
│   ├── summary.ts              #   Resumen diario (RC) y baja (RA)
│   ├── common.ts / lines.ts    #   Fragmentos compartidos
├── sign.ts                     # Firma XML-DSig (xml-crypto) + PFX→PEM (node-forge)
├── zip.ts                      # Empaquetado ZIP (fflate)
├── soap.ts                     # Cliente SOAP (sendBill/sendSummary/getStatus)
├── cdr.ts                      # Parser del CDR (Constancia de Recepción)
├── client.ts                   # SunatClient: orquesta todo el flujo
└── catalogs.ts / util.ts       # Catálogos SUNAT y utilidades (monto en letras)

apps/api/
├── lib/crypto.ts               # Cifrado AES-256-GCM de secretos
├── services/sunat.service.ts   # Mapeo BD ↔ UBL y persistencia
└── routes/sunat.ts             # /api/sunat/* (config + resumen)
   routes/invoices.ts           # /api/invoices/:id/{declarar,estado,nota-credito,anular}
```

## Configuración

1. **Variable de entorno** (servidor):

   ```env
   SUNAT_ENCRYPTION_KEY=<cadena aleatoria de 32+ caracteres>
   ```

   Cifra en reposo las credenciales SOL y el certificado. Generar con
   `openssl rand -hex 32`.

2. **Configurar el emisor** (por organización), con rol `org_admin`:

   ```http
   PUT /api/sunat/config
   Content-Type: application/json

   {
     "ruc": "20123456789",
     "razonSocial": "RESTAURANTE DEMO SAC",
     "nombreComercial": "RestAI Demo",
     "ubigeo": "150101",
     "departamento": "LIMA",
     "provincia": "LIMA",
     "distrito": "LIMA",
     "direccion": "AV. PRINCIPAL 123",
     "ambiente": "beta",
     "solUser": "MODDATOS",
     "solPass": "moddatos",
     "certificate": "<PFX en base64 o PEM>",
     "certificatePassword": "<clave del PFX>",
     "certificateFormat": "pfx",
     "enabled": true
   }
   ```

   - `ambiente`: `beta` (homologación) o `production`.
   - En **beta** SUNAT acepta el usuario `MODDATOS` / clave `moddatos`.
   - El certificado se acepta como **PFX/P12 en base64** (`certificateFormat: "pfx"`)
     o como **PEM** (`certificateFormat: "pem"`). Para homologar puedes usar el
     certificado de prueba que publica SUNAT.

   `GET /api/sunat/config` devuelve la configuración **sin** exponer los secretos.

## Uso

Los comprobantes se siguen creando como antes (`POST /api/invoices`). Después se
declaran ante SUNAT:

```http
POST /api/invoices/:id/declarar      # Factura/Boleta/Nota → envía y guarda el CDR
GET  /api/invoices/:id/estado        # Consulta el estado (resuelve tickets asíncronos)
POST /api/invoices/:id/nota-credito  # Emite NC sobre el comprobante { motivoCodigo, motivoDescripcion }
POST /api/invoices/:id/anular        # Comunicación de baja (facturas) { motivo, correlativo }
```

Para las **boletas** se usa el resumen diario:

```http
POST /api/sunat/resumen-diario       # { "fecha": "2026-06-20", "correlativo": 1 }
```

Esto agrupa todas las boletas `pending` de esa fecha, las envía en un resumen y
devuelve un `ticket`. El estado se consulta luego con `GET /api/invoices/:id/estado`
de cualquier boleta del lote (o reenviando el ticket).

### Estados (`sunat_status`)

- `pending` — creado, aún no enviado.
- `sent` — enviado, esperando respuesta/ticket (asíncrono).
- `accepted` — aceptado por SUNAT (CDR código `0`).
- `observed` — aceptado con observaciones (CDR `≥ 4000`).
- `rejected` — rechazado (CDR `2000–3999`).
- `voided` — dado de baja.
- `error` — error de comunicación o firma.

El comprobante guarda además: `sunat_code`, `sunat_description`, `sunat_ticket`,
`sunat_hash` (DigestValue), `xml_signed` (UBL firmado) y `cdr_xml` (la CDR).

## Notas técnicas

- **Firma**: enveloped XML-DSig con `RSA-SHA1` + `C14N`, insertada en
  `ext:UBLExtensions/ext:ExtensionContent` con `Id="SignatureSP"`, incluyendo el
  `X509Certificate`. Es el algoritmo que SUNAT acepta universalmente.
- **Montos**: la BD guarda céntimos; el servicio los convierte a soles, separa el
  valor de venta del IGV (18%) por línea y arma los totales de forma consistente.
- **Migración**: `packages/db/drizzle/0004_sunat_integration.sql` crea la tabla
  `sunat_config` y agrega columnas a `invoices`. Aplicar con `bun run db:migrate`.

## Pruebas

```bash
bun test packages/sunat
```

Cubren: generación UBL (factura, NC, resumen, baja), firma con verificación
criptográfica, round-trip de ZIP, parser de CDR (aceptado/rechazado) y monto en letras.
