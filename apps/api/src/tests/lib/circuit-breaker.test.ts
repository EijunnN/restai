import { describe, it, expect } from "bun:test";
import { crearCircuito } from "../../lib/circuit-breaker";

/**
 * Dejar de llamar a lo que está caído.
 *
 * Si esto se equivoca en un sentido, una caída de Redis vuelve a tumbar el
 * servicio —quince segundos por cada toque en la caja—. Si se equivoca en el
 * otro, el circuito se queda abierto para siempre y Redis no vuelve a usarse
 * aunque lleve horas sano: los contadores del limitador dejan de compartirse
 * entre instancias sin que nadie se entere.
 */
describe("lib/circuit-breaker", () => {
  /** Reloj de mentira: sin él habría que dormir de verdad en cada prueba. */
  function reloj(inicio = 0) {
    let t = inicio;
    return { ahora: () => t, avanzar: (ms: number) => (t += ms) };
  }

  it("empieza cerrado: deja pasar todo", () => {
    const c = crearCircuito();
    expect(c.permite()).toBe(true);
    expect(c.estado()).toBe("cerrado");
  });

  it("un fallo suelto no abre nada", () => {
    // Un timeout aislado no es una caída; abrir por uno solo dejaría de usar
    // Redis por un hipo de red.
    const c = crearCircuito({ umbral: 3 });
    c.fallo();
    expect(c.permite()).toBe(true);
    expect(c.estado()).toBe("cerrado");
  });

  it("al llegar al umbral se abre y deja de intentarlo", () => {
    const t = reloj();
    const c = crearCircuito({ umbral: 3, descansoMs: 10_000, ahora: t.ahora });
    c.fallo();
    c.fallo();
    c.fallo();
    expect(c.estado()).toBe("abierto");
    expect(c.permite()).toBe(false);
  });

  it("un éxito por el camino reinicia la cuenta", () => {
    const c = crearCircuito({ umbral: 3 });
    c.fallo();
    c.fallo();
    c.exito();
    c.fallo();
    c.fallo();
    // Van dos seguidos, no cuatro.
    expect(c.permite()).toBe(true);
  });

  it("pasado el descanso deja pasar UNA petición de prueba, no todas", () => {
    // Soltar de golpe todo el tráfico contra un Redis que sigue caído devuelve
    // el problema entero: cada petición vuelve a pagar los reintentos.
    const t = reloj();
    const c = crearCircuito({ umbral: 1, descansoMs: 10_000, ahora: t.ahora });
    c.fallo();
    expect(c.permite()).toBe(false);

    t.avanzar(10_001);
    expect(c.permite()).toBe(true);
    expect(c.estado()).toBe("probando");
    expect(c.permite()).toBe(false);
  });

  it("si la prueba sale bien, se cierra y todo vuelve solo", () => {
    const t = reloj();
    const c = crearCircuito({ umbral: 1, descansoMs: 10_000, ahora: t.ahora });
    c.fallo();
    t.avanzar(10_001);
    c.permite();
    c.exito();

    expect(c.estado()).toBe("cerrado");
    expect(c.permite()).toBe(true);
    expect(c.permite()).toBe(true);
  });

  it("si la prueba vuelve a fallar, se abre otro descanso completo", () => {
    const t = reloj();
    const c = crearCircuito({ umbral: 1, descansoMs: 10_000, ahora: t.ahora });
    c.fallo();
    t.avanzar(10_001);
    c.permite();
    c.fallo();

    expect(c.permite()).toBe(false);
    t.avanzar(9_000);
    expect(c.permite()).toBe(false);
    t.avanzar(1_500);
    expect(c.permite()).toBe(true);
  });

  it("avisa al abrir UNA vez, no en cada fallo", () => {
    // Con el circuito ya abierto, un log por petición inunda la salida y
    // esconde lo que sí importa.
    const t = reloj();
    let aperturas = 0;
    const c = crearCircuito({
      umbral: 1,
      descansoMs: 10_000,
      ahora: t.ahora,
      alAbrir: () => (aperturas += 1),
    });
    c.fallo();
    c.fallo();
    c.fallo();
    expect(aperturas).toBe(1);
  });

  it("avisa al recuperarse, para que quede rastro de que volvió", () => {
    const t = reloj();
    let recuperaciones = 0;
    const c = crearCircuito({
      umbral: 1,
      descansoMs: 1_000,
      ahora: t.ahora,
      alCerrar: () => (recuperaciones += 1),
    });
    c.fallo();
    t.avanzar(1_100);
    c.permite();
    c.exito();
    expect(recuperaciones).toBe(1);

    // Y no vuelve a avisar mientras todo va bien.
    c.exito();
    expect(recuperaciones).toBe(1);
  });
});
