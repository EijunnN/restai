import { describe, it, expect, afterEach } from "bun:test";
import {
  activeVoiceProvider,
  voiceAgentEnabled,
  openaiProvider,
  geminiProvider,
} from "../../lib/voice-providers/index";
import { VOICE_TOOLS } from "../../services/voice-agent.service";

/**
 * Selección de proveedor y traducción de herramientas.
 *
 * La traducción es lo delicado: Gemini acepta un SUBCONJUNTO de JSON Schema y
 * rechaza la declaración entera si llega un campo que no conoce. El síntoma no
 * es un error visible, es un mesero al que le falta una herramienta y que
 * improvisa en su lugar.
 */
describe("voice-providers", () => {
  const env = { ...process.env };
  const realFetch = globalThis.fetch;

  afterEach(() => {
    process.env = { ...env };
    globalThis.fetch = realFetch;
  });

  it("respeta VOICE_AGENT_PROVIDER por encima de la autodetección", () => {
    process.env.OPENAI_API_KEY = "sk-x";
    process.env.GEMINI_API_KEY = "g-x";

    process.env.VOICE_AGENT_PROVIDER = "gemini";
    expect(activeVoiceProvider()?.id).toBe("gemini");

    process.env.VOICE_AGENT_PROVIDER = "openai";
    expect(activeVoiceProvider()?.id).toBe("openai");
  });

  it("autodetecta por la clave disponible cuando no se declara proveedor", () => {
    delete process.env.VOICE_AGENT_PROVIDER;
    delete process.env.OPENAI_API_KEY;
    process.env.GEMINI_API_KEY = "g-x";
    expect(activeVoiceProvider()?.id).toBe("gemini");
  });

  it("un proveedor mal escrito apaga la voz en vez de caer en otro", () => {
    // Caer en silencio a otro proveedor significaría otra voz, otro precio y
    // otro modelo, sin que nadie se entere de que hay una errata.
    process.env.OPENAI_API_KEY = "sk-x";
    process.env.VOICE_AGENT_PROVIDER = "geminis";
    expect(activeVoiceProvider()).toBeNull();
    expect(voiceAgentEnabled()).toBe(false);
  });

  it("VOICE_AGENT_ENABLED=false apaga la voz aunque haya clave", () => {
    process.env.OPENAI_API_KEY = "sk-x";
    process.env.VOICE_AGENT_ENABLED = "false";
    expect(voiceAgentEnabled()).toBe(false);
  });

  it("cada proveedor declara su transporte y su modelo por defecto", () => {
    expect(openaiProvider.transport).toBe("openai-webrtc");
    expect(geminiProvider.transport).toBe("gemini-live");

    delete process.env.VOICE_AGENT_MODEL;
    expect(openaiProvider.model()).toBe("gpt-realtime-2.1-mini");
    expect(geminiProvider.model()).toBe("gemini-3.1-flash-live-preview");
  });

  it("Gemini traduce el esquema: tipos en mayúsculas y sin validadores numéricos", async () => {
    process.env.GEMINI_API_KEY = "g-x";
    delete process.env.VOICE_AGENT_MODEL;

    let body: any = null;
    globalThis.fetch = (async (_url: any, init: any) => {
      body = JSON.parse(init.body);
      return new Response(JSON.stringify({ name: "auth_tokens/fake" }), { status: 200 });
    }) as unknown as typeof fetch;

    await geminiProvider.createSession({
      instructions: "Eres el mesero",
      tools: VOICE_TOOLS,
    });

    const declarations = body.bidiGenerateContentSetup.tools[0].functionDeclarations;
    const serialized = JSON.stringify(declarations);

    // `minimum`/`maximum` hacen que Gemini rechace la declaración entera.
    expect(serialized).not.toContain("minimum");
    expect(serialized).not.toContain("maximum");
    // Los tipos van en mayúsculas en el subconjunto de OpenAPI que acepta.
    expect(serialized).not.toContain('"type":"object"');
    expect(serialized).not.toContain('"type":"string"');

    const agregar = declarations.find((d: any) => d.name === "agregar_al_carrito");
    expect(agregar.parameters.type).toBe("OBJECT");
    expect(agregar.parameters.properties.ref.type).toBe("STRING");
    expect(agregar.parameters.properties.modificadores.type).toBe("ARRAY");
    expect(agregar.parameters.properties.modificadores.items.type).toBe("STRING");
  });

  it("Gemini omite `parameters` en las herramientas sin argumentos", async () => {
    process.env.GEMINI_API_KEY = "g-x";
    let body: any = null;
    globalThis.fetch = (async (_url: any, init: any) => {
      body = JSON.parse(init.body);
      return new Response(JSON.stringify({ name: "auth_tokens/fake" }), { status: 200 });
    }) as unknown as typeof fetch;

    await geminiProvider.createSession({ instructions: "x", tools: VOICE_TOOLS });

    // Gemini rechaza `{type:"OBJECT", properties:{}}`: una función sin
    // argumentos debe declararse SIN el campo `parameters`.
    const leer = body.bidiGenerateContentSetup.tools[0].functionDeclarations.find(
      (d: any) => d.name === "leer_carrito",
    );
    expect(leer).toBeTruthy();
    expect(leer.parameters).toBeUndefined();
  });

  it("Gemini deja el prompt en el token, no en el cliente", async () => {
    process.env.GEMINI_API_KEY = "g-x";
    let body: any = null;
    globalThis.fetch = (async (_url: any, init: any) => {
      body = JSON.parse(init.body);
      return new Response(JSON.stringify({ name: "auth_tokens/fake" }), { status: 200 });
    }) as unknown as typeof fetch;

    const grant = await geminiProvider.createSession({
      instructions: "SECRETO: eres el mesero de este local",
      tools: VOICE_TOOLS,
    });

    // Va dentro de las restricciones del token: el navegador abre la sesión
    // pero no puede reescribir lo que el mesero tiene permitido hacer.
    expect(body.bidiGenerateContentSetup.systemInstruction.parts[0].text).toContain(
      "SECRETO",
    );
    expect(body.uses).toBe(1);
    // La transcripción de la salida es lo que alimenta los subtítulos.
    expect(body.bidiGenerateContentSetup.outputAudioTranscription).toBeTruthy();

    // Y lo que baja a la tablet es solo la credencial, nunca la clave ni el prompt.
    expect(grant.clientSecret).toBe("auth_tokens/fake");
    expect(JSON.stringify(grant)).not.toContain("SECRETO");
    expect(JSON.stringify(grant)).not.toContain("g-x");
  });

  it("Gemini expone al cliente las frecuencias que exige su protocolo", async () => {
    process.env.GEMINI_API_KEY = "g-x";
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ name: "auth_tokens/fake" }), {
        status: 200,
      })) as unknown as typeof fetch;

    const grant = await geminiProvider.createSession({ instructions: "x", tools: [] });

    expect(grant.transport).toBe("gemini-live");
    expect(grant.connection.inputSampleRate).toBe(16000);
    expect(grant.connection.outputSampleRate).toBe(24000);
    expect(String(grant.connection.wsUrl)).toContain("BidiGenerateContentConstrained");
    expect(grant.model).toBe("models/gemini-3.1-flash-live-preview");
  });
});
