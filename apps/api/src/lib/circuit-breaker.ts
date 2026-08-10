/**
 * Dejar de llamar a lo que está caído.
 *
 * El limitador de peticiones ya degradaba a memoria cuando Redis no respondía,
 * así que "hay fallback" parecía suficiente. No lo era: reintentaba Redis en
 * CADA petición y pagaba el precio entero de los reintentos —tres, con espera
 * creciente— antes de rendirse. Con Redis caído, medido en esta misma máquina:
 *
 *     GET /health          15 s   (con Redis: 6 ms)
 *     GET /api/orders      10 s
 *     suite de la API      182 s  (con Redis: 3 s)
 *
 * Es decir: una caída de Redis no degradaba el sistema, lo inutilizaba. En un
 * local eso son quince segundos por cada toque en la caja, con el cliente
 * delante, y sin ningún mensaje que explique qué pasa. Redis es una caché y una
 * coordinación entre instancias; que su caída tumbe el servicio es exactamente
 * lo que no debe ocurrir.
 *
 * El cortacircuitos convierte el primer fallo en una decisión: tras `umbral`
 * fallos seguidos deja de intentarlo durante `descansoMs`, y el fallback entra
 * de inmediato y sin coste. Pasado ese tiempo deja pasar UNA petición de prueba;
 * si va bien, se cierra y todo vuelve a la normalidad sin que nadie intervenga.
 *
 * No se apoya en los eventos de conexión de ioredis a propósito: lo que importa
 * no es si el socket dice estar conectado, sino si las operaciones REALES están
 * saliendo. Un Redis que acepta la conexión y no responde a los comandos deja
 * los eventos en verde y el servicio igual de parado.
 */

export type EstadoCircuito = "cerrado" | "abierto" | "probando";

export interface Circuito {
  /** ¿Merece la pena intentarlo ahora mismo? */
  permite(): boolean;
  /** La operación salió bien. */
  exito(): void;
  /** La operación falló. */
  fallo(): void;
  estado(): EstadoCircuito;
}

export function crearCircuito({
  umbral = 3,
  descansoMs = 10_000,
  ahora = () => Date.now(),
  alAbrir,
  alCerrar,
}: {
  /** Fallos seguidos que abren el circuito. */
  umbral?: number;
  /** Cuánto se deja de intentar antes de volver a probar. */
  descansoMs?: number;
  /** Reloj inyectable: sin esto las pruebas tendrían que dormir de verdad. */
  ahora?: () => number;
  alAbrir?: () => void;
  alCerrar?: () => void;
} = {}): Circuito {
  let fallosSeguidos = 0;
  let abiertoHasta = 0;
  /** Hay una petición de prueba en vuelo; nadie más debe colarse. */
  let probando = false;

  function estado(): EstadoCircuito {
    if (probando) return "probando";
    return ahora() < abiertoHasta ? "abierto" : "cerrado";
  }

  return {
    permite() {
      if (ahora() < abiertoHasta) return false;
      // Terminado el descanso pasa UNA sola petición de prueba. Soltarlas todas
      // a la vez sobre un Redis que sigue caído devuelve el problema entero.
      if (abiertoHasta > 0 && !probando) {
        probando = true;
        return true;
      }
      return !probando;
    },

    exito() {
      const veniaDeCaida = abiertoHasta > 0;
      fallosSeguidos = 0;
      abiertoHasta = 0;
      probando = false;
      if (veniaDeCaida) alCerrar?.();
    },

    fallo() {
      probando = false;
      fallosSeguidos += 1;
      if (fallosSeguidos >= umbral) {
        const yaEstaba = ahora() < abiertoHasta;
        abiertoHasta = ahora() + descansoMs;
        // El aviso se emite al ABRIR, no en cada fallo: con Redis caído y el
        // circuito ya abierto, un log por petición inunda la salida y esconde
        // lo que sí importa.
        if (!yaEstaba) alAbrir?.();
      }
    },

    estado,
  };
}
