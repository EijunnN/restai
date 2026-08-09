import { describe, it, expect } from "bun:test";
import { geminiProvider } from "../../lib/voice-providers/gemini";
import { VOICE_TOOLS } from "../../services/voice-agent.service";

/**
 * Contrato REAL con la Live API de Gemini.
 *
 * ── Por qué este archivo existe ──────────────────────────────────────────────
 * Los otros tests del proveedor sustituyen `fetch` por un doble, así que
 * comprueban la forma del cuerpo que NOSOTROS creemos correcta — no la que
 * Google acepta. Con esa red de seguridad se coló un error real: los SDK llaman
 * al campo `liveConnectConstraints`, pero el REST lo llama
 * `bidiGenerateContentSetup` y rechaza el otro nombre con un 400. Todos los
 * tests pasaban y la integración no habría funcionado ni una vez.
 *
 * Esta prueba llama de verdad. Se SALTA sola si no hay `GEMINI_API_KEY`, para
 * que CI y quien no use Gemini no se vean obligados a tener credenciales.
 */

const KEY = process.env.GEMINI_API_KEY;
const describeLive = KEY ? describe : describe.skip;

describeLive("gemini live contract (requiere GEMINI_API_KEY)", () => {
  it("acuña un token real con el prompt y las herramientas del mesero", async () => {
    const grant = await geminiProvider.createSession({
      instructions: "Eres el mesero de un restaurante de prueba.",
      tools: VOICE_TOOLS,
      safetyIdentifier: "test_contract",
    });

    // Si el nombre del campo, la anidación de `generationConfig` o el esquema de
    // alguna herramienta estuvieran mal, esto habría lanzado un 400 traducido a
    // VoiceProviderError antes de llegar aquí.
    expect(grant.clientSecret).toStartWith("auth_tokens/");
    expect(grant.transport).toBe("gemini-live");
    expect(grant.model).toStartWith("models/");
  }, 30_000);
});
