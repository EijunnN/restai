import { eq } from "drizzle-orm";
import { db, schema, type DbOrTx } from "@restai/db";
import { generateShortCode } from "./id.js";

/**
 * Código público de una sede: el identificador que sí es único en todo el
 * sistema.
 *
 * El `slug` no sirve para esto. Su restricción es (organization_id, slug), así
 * que dos cadenas distintas pueden tener cada una su "miraflores". El flujo con
 * mesa se salva porque resuelve por el código de la mesa —único global— y usa
 * el slug solo para confirmar; una carta de sede, sin mesa, no tiene esa ancla
 * y sin este código serviría la carta del restaurante equivocado.
 *
 * Seis caracteres del alfabeto sin ambigüedades: 30^6 ≈ 729 millones. No
 * pretende ser secreto —va impreso en un cartel— sino corto y dictable.
 *
 * La comprobación de existencia evita el choque práctico; la garantía de verdad
 * es la restricción UNIQUE de la base (`uq_branches_public_code`). Si dos altas
 * simultáneas eligieran el mismo código, la segunda falla en el INSERT en vez
 * de quedarse con una sede inalcanzable, que es exactamente lo que se quiere.
 */
export async function generarCodigoPublicoDeSede(ejecutor: DbOrTx = db): Promise<string> {
  for (let intento = 0; intento < 8; intento++) {
    const candidato = generateShortCode(6);

    const [existente] = await ejecutor
      .select({ id: schema.branches.id })
      .from(schema.branches)
      .where(eq(schema.branches.public_code, candidato))
      .limit(1);

    if (!existente) return candidato;
  }

  throw new Error("No se pudo generar un código público de sede único");
}
