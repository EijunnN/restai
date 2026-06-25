import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

// ── Binding nativo R2 (Cloudflare Workers) ────────────────────────────────────
// En Workers se inyecta el R2Bucket desde worker.ts → configureR2Bucket().
// Acceso nativo: sin credenciales externas, sin S3 overhead, sin HTTPS extra.
// En Bun/Node (VPS/local) el binding es undefined y se usa el fallback S3.
// ─────────────────────────────────────────────────────────────────────────────

let _r2Bucket: R2Bucket | null = null;

export function configureR2Bucket(bucket: R2Bucket | undefined) {
  if (bucket) _r2Bucket = bucket;
}

// ── Fallback S3 (Bun / Node) ─────────────────────────────────────────────────
// En Workers process.env se puebla en configure() DESPUÉS de que los módulos se
// importan, así que instanciamos S3Client de forma lazy en el primer uso para
// que las credenciales ya estén disponibles.
// ─────────────────────────────────────────────────────────────────────────────

let _s3: S3Client | null = null;

function getS3(): S3Client {
  if (!_s3) {
    const accountId = process.env.R2_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    if (!accountId || !accessKeyId || !secretAccessKey) {
      throw new Error(
        "R2 credentials not configured (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY)",
      );
    }
    _s3 = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  return _s3;
}

// ── API pública ───────────────────────────────────────────────────────────────

export async function uploadToR2(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string,
) {
  if (_r2Bucket) {
    await _r2Bucket.put(key, body, { httpMetadata: { contentType } });
    return;
  }
  const bucket = process.env.R2_BUCKET_NAME || "restai-images";
  await getS3().send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
  );
}

export async function deleteFromR2(key: string) {
  if (_r2Bucket) {
    await _r2Bucket.delete(key);
    return;
  }
  const bucket = process.env.R2_BUCKET_NAME || "restai-images";
  await getS3().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export function getPublicUrl(key: string): string {
  return `${process.env.R2_PUBLIC_URL}/${key}`;
}
