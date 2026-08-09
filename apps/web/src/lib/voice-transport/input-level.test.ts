import { describe, expect, test } from "bun:test";
import { pcmLevel, smoothLevel } from "./types";

/**
 * La señal de "te estoy oyendo".
 *
 * Si esto se equivoca, o la pantalla tiembla toda la noche con el ruido del
 * comedor —y una señal siempre encendida no avisa de nada— o no se mueve cuando
 * el comensal habla, que es el caso que hace que repita más alto y acabe
 * tocando la carta.
 */

function tono(muestras: number, amplitud: number): Int16Array {
  const pcm = new Int16Array(muestras);
  for (let i = 0; i < muestras; i++) {
    pcm[i] = Math.round(Math.sin((i / muestras) * Math.PI * 2 * 8) * amplitud * 32767);
  }
  return pcm;
}

describe("pcmLevel", () => {
  test("el silencio absoluto es cero", () => {
    expect(pcmLevel(new Int16Array(512))).toBe(0);
  });

  test("un bloque vacío no revienta ni devuelve NaN", () => {
    expect(pcmLevel(new Int16Array(0))).toBe(0);
  });

  test("más voz, más nivel", () => {
    const bajo = pcmLevel(tono(512, 0.1));
    const medio = pcmLevel(tono(512, 0.4));
    const alto = pcmLevel(tono(512, 0.9));
    expect(bajo).toBeLessThan(medio);
    expect(medio).toBeLessThan(alto);
  });

  test("nunca se pasa de 1, por fuerte que se grite", () => {
    // Un grito pegado al micro satura el int16; sin el tope, la animación
    // crecería sin límite y se saldría de la pantalla.
    const gritando = new Int16Array(512).fill(32767);
    expect(pcmLevel(gritando)).toBe(1);
  });

  test("mide el CUERPO de la voz, no el pico", () => {
    // Un golpe en la mesa es una muestra altísima entre 511 silenciosas. Con el
    // pico, la pantalla pegaría un salto; con la media cuadrática, apenas se
    // entera. Es la diferencia entre una señal legible y un tic nervioso.
    const golpe = new Int16Array(512);
    golpe[0] = 32767;
    expect(pcmLevel(golpe)).toBeLessThan(0.2);
  });

  test("el mismo sonido da el mismo nivel, dure lo que dure el bloque", () => {
    // El tamaño del bloque lo decide el dispositivo; si el nivel dependiera de
    // él, la animación sería más viva en unas tablets que en otras.
    const corto = pcmLevel(tono(256, 0.5));
    const largo = pcmLevel(tono(1024, 0.5));
    expect(Math.abs(corto - largo)).toBeLessThan(0.05);
  });
});

describe("smoothLevel", () => {
  test("sube rápido y baja despacio, como el cuerpo de una voz", () => {
    // Al revés, el indicador llegaría tarde al principio de cada frase y se
    // quedaría encendido después: justo lo contrario de lo que hace una voz.
    const subida = smoothLevel(0, 1);
    const bajada = smoothLevel(1, 0);
    expect(subida).toBeGreaterThan(0.4);
    expect(bajada).toBeGreaterThan(0.8);
  });

  test("desde el silencio, converge a cero sin quedarse encendido", () => {
    let n = 1;
    for (let i = 0; i < 60; i++) n = smoothLevel(n, 0);
    expect(n).toBeLessThan(0.01);
  });

  test("nunca supera 1 aunque el objetivo se pase", () => {
    expect(smoothLevel(0.9, 5)).toBeLessThanOrEqual(1);
  });
});
