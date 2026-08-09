import { describe, expect, test } from "bun:test";

/**
 * La voz del comensal tiene que llegar a la pantalla.
 *
 * Antes no llegaba nunca: Gemini la mandaba en `inputTranscription` y el
 * cliente la descartaba tras usarla solo como señal de "turno nuevo", y a
 * OpenAI ni se le pedía. El resultado era que el comensal hablaba y solo veía
 * la respuesta del mesero, que puede sonar correcta habiendo entendido otra
 * cosa.
 *
 * Se prueban los dos parseos por separado, sin red: es la forma del mensaje de
 * cada proveedor lo que hay que fijar, y es justo lo que cambia sin avisar.
 */

/** Reproduce la decisión que toma el cliente de Gemini con cada mensaje. */
function handleGemini(
  server: Record<string, any>,
  cb: { onUserTranscript: (t: string) => void; onTranscriptReset: () => void },
) {
  if (server.outputTranscription?.text) {
    // Voz del agente: no es la del comensal y no debe confundirse.
    return;
  }
  if (server.inputTranscription?.text) {
    cb.onTranscriptReset();
    cb.onUserTranscript(server.inputTranscription.text);
  }
}

/** Reproduce el `switch` del canal de datos de OpenAI. */
function handleOpenAI(
  event: Record<string, any>,
  cb: { onUserTranscript: (t: string) => void },
) {
  switch (event.type) {
    case "conversation.item.input_audio_transcription.completed": {
      const texto = typeof event.transcript === "string" ? event.transcript.trim() : "";
      if (texto) cb.onUserTranscript(texto);
      break;
    }
    default:
      break;
  }
}

describe("Gemini", () => {
  test("emite lo que dijo el comensal en vez de tirarlo", () => {
    const dichos: string[] = [];
    let reseteos = 0;
    handleGemini(
      { inputTranscription: { text: "ponme dos ceviches, uno sin ají" } },
      { onUserTranscript: (t) => dichos.push(t), onTranscriptReset: () => reseteos++ },
    );
    expect(dichos).toEqual(["ponme dos ceviches, uno sin ají"]);
    // Sigue marcando turno nuevo: era su única función antes y hay que conservarla.
    expect(reseteos).toBe(1);
  });

  test("la voz del AGENTE no se cuela como voz del comensal", () => {
    const dichos: string[] = [];
    handleGemini(
      { outputTranscription: { text: "claro, ¿algo más?" } },
      { onUserTranscript: (t) => dichos.push(t), onTranscriptReset: () => {} },
    );
    expect(dichos).toEqual([]);
  });

  test("un mensaje sin transcripción no emite nada", () => {
    const dichos: string[] = [];
    handleGemini({ modelTurn: { parts: [] } }, {
      onUserTranscript: (t) => dichos.push(t),
      onTranscriptReset: () => {},
    });
    expect(dichos).toEqual([]);
  });
});

describe("OpenAI", () => {
  test("emite la transcripción completa del comensal", () => {
    const dichos: string[] = [];
    handleOpenAI(
      {
        type: "conversation.item.input_audio_transcription.completed",
        transcript: "  y una chicha morada  ",
      },
      { onUserTranscript: (t) => dichos.push(t) },
    );
    expect(dichos).toEqual(["y una chicha morada"]);
  });

  test("una transcripción vacía no pinta una línea en blanco", () => {
    const dichos: string[] = [];
    handleOpenAI(
      { type: "conversation.item.input_audio_transcription.completed", transcript: "   " },
      { onUserTranscript: (t) => dichos.push(t) },
    );
    expect(dichos).toEqual([]);
  });

  test("la voz del agente va por otro evento y no se mezcla", () => {
    const dichos: string[] = [];
    handleOpenAI(
      { type: "response.output_audio_transcript.delta", delta: "claro que sí" },
      { onUserTranscript: (t) => dichos.push(t) },
    );
    expect(dichos).toEqual([]);
  });
});
