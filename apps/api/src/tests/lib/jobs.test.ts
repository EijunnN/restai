import { describe, it, expect } from "bun:test";
import { isLoyaltyDailyWindow, LOYALTY_DAILY_PERU_HOUR } from "../../lib/jobs";

/**
 * Ventana diaria de los trabajos de fidelización en el Worker.
 *
 * Es la única lógica que separa "cada 5 minutos" (expiración de sesiones) de
 * "una vez al día" (fidelización), y falla en silencio en las dos direcciones:
 * si el desfase horario está mal, o los trabajos NUNCA corren —los puntos vencen
 * sin avisar al cliente y los cumpleaños no se premian— o vuelven a correr 288
 * veces al día, que es justo el defecto que esto arregla. Ninguno de los dos
 * casos deja rastro visible, así que va con prueba.
 */

/** Instante UTC correspondiente a una hora civil de Lima (UTC-5 todo el año). */
function limaTime(hour: number, minute: number): Date {
  return new Date(Date.UTC(2026, 7, 7, hour + 5, minute, 0));
}

describe("isLoyaltyDailyWindow", () => {
  it("abre en el primer disparo de la hora elegida en Lima", () => {
    expect(isLoyaltyDailyWindow(limaTime(LOYALTY_DAILY_PERU_HOUR, 0))).toBe(true);
  });

  it("se cierra en los disparos siguientes de esa misma hora", () => {
    // Con el cron de 5 minutos solo puede encajar UN disparo al día.
    for (const minute of [5, 10, 30, 55]) {
      expect(isLoyaltyDailyWindow(limaTime(LOYALTY_DAILY_PERU_HOUR, minute))).toBe(false);
    }
  });

  it("no abre en horario de servicio", () => {
    // Mediodía y noche: ni la carga de BD ni los correos deben caer aquí.
    expect(isLoyaltyDailyWindow(limaTime(12, 0))).toBe(false);
    expect(isLoyaltyDailyWindow(limaTime(21, 0))).toBe(false);
  });

  it("usa la hora de Lima, no la UTC", () => {
    // A las 03:00 UTC en Lima son las 22:00 del día anterior: no debe abrir.
    expect(isLoyaltyDailyWindow(new Date(Date.UTC(2026, 7, 7, LOYALTY_DAILY_PERU_HOUR, 0)))).toBe(
      false,
    );
  });

  it("abre exactamente una vez al día recorriendo los disparos de 5 minutos", () => {
    let aperturas = 0;
    for (let i = 0; i < (24 * 60) / 5; i++) {
      const t = new Date(Date.UTC(2026, 7, 7, 0, 0, 0) + i * 5 * 60_000);
      if (isLoyaltyDailyWindow(t)) aperturas++;
    }
    expect(aperturas).toBe(1);
  });
});
