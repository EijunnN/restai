import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

// En Cloudflare Workers process.env se puebla en configure() al inicio de cada
// request — DESPUÉS de que los módulos se importan. Si instanciamos S3Client a
// nivel de módulo, las credenciales quedan undefined y todas las subidas fallan.
// Solución: instanciar lazy en el primer uso, cuando process.env ya está listo.
let _s3: S3Client | null = null;

function getS3(): S3Client {
  if (!_s3) {
    const accountId = process.env.R2_ACCOUNT_ID;
    const accessKeyId = process.env.R2_ACCESS_KEY_ID;
    const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
    if (!accountId || !accessKeyId || !secretAccessKey) {
      throw new Error("R2 credentials not configured (R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY)");
    }
    _s3 = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  return _s3;
}

export async function uploadToR2(
  key: string,
  body: Buffer | Uint8Array,
  contentType: string,
) {
  const bucket = process.env.R2_BUCKET_NAME || "restai-images";
  await getS3().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function deleteFromR2(key: string) {
  const bucket = process.env.R2_BUCKET_NAME || "restai-images";
  await getS3().send(
    new DeleteObjectCommand({
      Bucket: bucket,
      Key: key,
    }),
  );
}

export function getPublicUrl(key: string): string {
  return `${process.env.R2_PUBLIC_URL}/${key}`;
}
