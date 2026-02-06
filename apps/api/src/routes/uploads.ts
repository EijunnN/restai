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

const uploads = new Hono<AppEnv>();
uploads.use("*", authMiddleware, tenantMiddleware);

// POST / — Upload single image
uploads.post("/", async (c) => {
  const tenant = c.get("tenant") as any;
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

  if (!ALLOWED_TYPES.has(file.type)) {
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

  const ext = extFromMime(file.type);
  const uuid = crypto.randomUUID();
  const key = `${tenant.organizationId}/${uploadType}/${uuid}.${ext}`;

  const buffer = new Uint8Array(await file.arrayBuffer());
  await uploadToR2(key, buffer, file.type);

  const url = getPublicUrl(key);
  return c.json({ success: true, data: { url, key } });
});

// DELETE /:key — Delete image
uploads.delete("/*", async (c) => {
  const key = c.req.path.slice(1); // remove leading /
  if (!key) {
    return c.json(
      {
        success: false,
        error: { code: "BAD_REQUEST", message: "Se requiere la key del archivo" },
      },
      400,
    );
  }

  await deleteFromR2(key);
  return c.json({ success: true, data: { deleted: key } });
});

export { uploads };
