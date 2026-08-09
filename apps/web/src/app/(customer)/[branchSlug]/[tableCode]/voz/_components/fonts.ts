import { Fraunces } from "next/font/google";

/**
 * Tipografía de la pantalla de voz.
 *
 * Fraunces y no la Inter del resto de la aplicación: aquí el nombre del plato se
 * pinta a 8rem y ocupa media pantalla, así que la letra deja de ser un vehículo
 * neutro y pasa a ser la imagen. Fraunces tiene un eje `SOFT` que redondea los
 * remates y otro `WONK` que deforma la itálica; a tamaño grande da una calidez
 * de carta escrita a mano que una grotesca no puede dar, y no es la serif de
 * catálogo que sale por defecto.
 *
 * Solo se carga en esta ruta. El resto de la aplicación sigue con Inter.
 */
export const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
  axes: ["SOFT", "WONK", "opsz"],
});
