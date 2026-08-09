import type { CSSProperties } from "react";

/**
 * El material translúcido de la pantalla.
 *
 * ── Qué hace que el vidrio parezca vidrio ────────────────────────────────────
 * Un `backdrop-blur` a secas produce un panel gris sucio. Lo que da la
 * sensación de cristal son tres cosas juntas, y hay que poner las tres:
 *
 *  1. **Saturación** en el desenfoque. El color de detrás se intensifica al
 *     atravesarlo, como en un cristal real. Sin esto, la foto de comida que hay
 *     debajo se ve lavada y el panel parece plástico.
 *  2. **Borde de luz superior.** Una línea clarísima en el canto de arriba y una
 *     oscura abajo: es la reflexión especular del borde. Es lo que hace que el
 *     panel tenga grosor en vez de ser una capa de pintura.
 *  3. **Fondo casi transparente.** La tentación es subir la opacidad para que se
 *     lea el texto; el resultado es un rectángulo opaco. La legibilidad la da la
 *     sombra del texto, no el relleno.
 *
 * Se define aquí y no suelto en cada componente para que todas las superficies
 * de la pantalla tengan exactamente el mismo grosor de cristal. Materiales
 * distintos en la misma pantalla se leen como un error, no como variedad.
 */
export const glassSurface: CSSProperties = {
  background: "rgba(38, 32, 28, 0.42)",
  backdropFilter: "blur(28px) saturate(180%)",
  WebkitBackdropFilter: "blur(28px) saturate(180%)",
  boxShadow: [
    // Borde de luz: canto superior iluminado, canto inferior en sombra.
    "inset 0 1px 0 rgba(247,241,232,0.16)",
    "inset 0 -1px 0 rgba(0,0,0,0.25)",
    // Sombra proyectada, amplia y muy suave: separa del fondo sin ensuciarlo.
    "0 24px 60px -20px rgba(0,0,0,0.65)",
  ].join(", "),
};

/** Variante más ligera para elementos pequeños (cápsulas, píldoras). */
export const glassChip: CSSProperties = {
  background: "rgba(38, 32, 28, 0.5)",
  backdropFilter: "blur(18px) saturate(170%)",
  WebkitBackdropFilter: "blur(18px) saturate(170%)",
  boxShadow: "inset 0 1px 0 rgba(247,241,232,0.14), 0 8px 24px -10px rgba(0,0,0,0.55)",
};

/**
 * Muelle común de la pantalla.
 *
 * Amortiguación alta y rigidez media: el movimiento tiene peso y se posa sin
 * rebotar. Un muelle elástico se lee como juguete; aquí se busca que las cosas
 * parezcan objetos, no globos.
 */
export const SPRING = { type: "spring" as const, stiffness: 260, damping: 30, mass: 0.9 };

/** Curva larga para entradas y salidas de superficies grandes. */
export const EASE_OUT = [0.16, 1, 0.3, 1] as const;
