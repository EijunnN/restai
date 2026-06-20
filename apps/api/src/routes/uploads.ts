import { Hono } from "hono";
import type { AppEnv } from "../types.js";
import { authMiddleware } from "../middleware/auth.js";
import { tenantMiddleware } from "../middleware/tenant.js";
import { uploadToR2, deleteFromR2, getPublicUrl } from "../lib/r2.js";

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);
const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_UPLOAD_TYPES = new Set(["menu", "logo", "category"]);

function extFromMime(mime: string): string {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "bin";
  }
}

// Detect the real image type by sniffing magic bytes instead of trusting the
// client-supplied file.type. Returns the canonical MIME of an allowed raster
// image, or null if the bytes don't match a supported format.
function sniffImageType(bytes: Uint8Array): string | null {
  // JPEG: FF D8 FF
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  // GIF: "GIF87a" or "GIF89a"
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return "image/gif";
  }
  // WebP: "RIFF" .... "WEBP"
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

const uploads = new Hono<AppEnv>();
uploads.use("*", authMiddleware, tenantMiddleware);

// POST / — Upload single image
uploads.post("/", async (c) => {
  const tenant = c.get("tenant") as any;

  // Reject early on the declared body size before buffering formData, aligned
  // with the 5MB business limit. (multipart adds boundary overhead, so this is a
  // cheap upper-bound guard; the exact byte check happens after we have the file.)
  const contentLength = Number(c.req.header("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_SIZE) {
    return c.json(
      {
        success: false,
        error: {
          code: "BAD_REQUEST",
          message: "El archivo excede el tamaño máximo de 5MB",
        },
      },
      413,
    );
  }

  const formData = await c.req.formData();

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return c.json(
      {
        success: false,
        error: { code: "BAD_REQUEST", message: "Se requiere un archivo" },
      },
      400,
    );
  }

  if (file.size > MAX_SIZE) {
    return c.json(
      {
        success: false,
        error: {
          code: "BAD_REQUEST",
          message: "El archivo excede el tamaño máximo de 5MB",
        },
      },
      400,
    );
  }

  const uploadType = (formData.get("type") as string) || "menu";
  if (!ALLOWED_UPLOAD_TYPES.has(uploadType)) {
    return c.json(
      {
        success: false,
        error: {
          code: "BAD_REQUEST",
          message: "Tipo de upload inválido. Usa menu, logo o category",
        },
      },
      400,
    );
  }

  // Sniff magic bytes — never trust the client-supplied file.type. The detected
  // type drives both validation and the stored Content-Type.
  const buffer = new Uint8Array(await file.arrayBuffer());
  const detectedType = sniffImageType(buffer);
  if (!detectedType || !ALLOWED_TYPES.has(detectedType)) {
    return c.json(
      {
        success: false,
        error: {
          code: "BAD_REQUEST",
          message: "Tipo de archivo no permitido. Usa JPEG, PNG, WebP o GIF",
        },
      },
      400,
    );
  }

  const ext = extFromMime(detectedType);
  const uuid = crypto.randomUUID();
  const key = `${tenant.organizationId}/${uploadType}/${uuid}.${ext}`;

  await uploadToR2(key, buffer, detectedType);

  const url = getPublicUrl(key);
  return c.json({ success: true, data: { url, key } });
});

// DELETE /api/uploads/<key> — Delete image.
// <key> is the stored R2 object key: `${organizationId}/${type}/${uuid}.${ext}`.
const ROUTE_PREFIX = "/api/uploads/";

uploads.delete("/*", async (c) => {
  const tenant = c.get("tenant") as any;

  // Derive the real object key by stripping the route prefix. c.req.path is the
  // full request path (e.g. "/api/uploads/<org>/menu/<uuid>.jpg"); the previous
  // `slice(1)` produced "api/uploads/..." which never matched a stored key.
  const rawPath = c.req.path;
  const idx = rawPath.indexOf(ROUTE_PREFIX);
  let key = idx >= 0 ? rawPath.slice(idx + ROUTE_PREFIX.length) : "";
  // The router may URL-encode segments; decode so the key matches what we stored.
  try {
    key = decodeURIComponent(key);
  } catch {
    // Malformed percent-encoding — treat as a bad key below.
    key = "";
  }

  if (!key) {
    return c.json(
      {
        success: false,
        error: { code: "BAD_REQUEST", message: "Se requiere la key del archivo" },
      },
      400,
    );
  }

  // Normalize against path traversal: reject absolute paths, backslashes, NUL,
  // and any `..` segment so a caller can't escape their org prefix.
  const normalized = key.replace(/\\/g, "/");
  if (
    normalized.startsWith("/") ||
    normalized.includes("\0") ||
    normalized.split("/").some((seg) => seg === ".." || seg === ".")
  ) {
    return c.json(
      {
        success: false,
        error: { code: "BAD_REQUEST", message: "Key de archivo inválida" },
      },
      400,
    );
  }

  // IDOR guard: the key MUST live under the caller's organization prefix.
  const orgPrefix = `${tenant.organizationId}/`;
  if (!normalized.startsWith(orgPrefix)) {
    return c.json(
      {
        success: false,
        error: { code: "FORBIDDEN", message: "No tienes acceso a este archivo" },
      },
      403,
    );
  }

  try {
    await deleteFromR2(normalized);
  } catch (err: any) {
    const code = err?.name || err?.Code || err?.$metadata?.httpStatusCode;
    if (code === "NoSuchKey" || code === "NotFound" || code === 404) {
      return c.json(
        {
          success: false,
          error: { code: "NOT_FOUND", message: "Archivo no encontrado" },
        },
        404,
      );
    }
    throw err;
  }

  return c.json({ success: true, data: { deleted: normalized } });
});

export { uploads };
