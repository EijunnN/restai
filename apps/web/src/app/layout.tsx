import type { Metadata } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Toaster } from "sonner";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "RestAI - Sistema de Restaurantes",
  description: "Plataforma inteligente para gestión de restaurantes",
};

/**
 * Aplica el tema guardado ANTES del primer pintado.
 *
 * Sin esto, el dispositivo que eligió modo claro vería un fogonazo oscuro en
 * cada carga: el HTML llega con la clase por defecto y React solo la corrige
 * después de hidratar. En una tablet de cocina que se recarga sola varias veces
 * por turno, ese parpadeo se nota. Debe ser un script bloqueante y sin
 * dependencias — por eso va en línea y no en un componente.
 *
 * Se inyecta con `next/script` + `beforeInteractive` y NO como un `<script>`
 * suelto dentro del `<head>`: React avisa por consola de que los scripts que
 * renderiza un componente no se ejecutan en el cliente, y aunque aquí eso daba
 * igual (solo hace falta en la carga del documento), el aviso ensuciaba la
 * consola en cada pantalla y tapaba errores de verdad.
 *
 * La clave `restai_theme` es la misma que usa `useTheme`.
 */
const THEME_INIT = `
(function () {
  try {
    var t = localStorage.getItem("restai_theme");
    if (t !== "light" && t !== "dark") t = "dark";
    document.documentElement.classList.toggle("dark", t === "dark");
    document.documentElement.style.colorScheme = t;
  } catch (e) {
    // localStorage bloqueado (modo privado, permisos): se queda el tema oscuro
    // por defecto, que es el que ya trae el HTML.
  }
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" suppressHydrationWarning className="dark">
      <body className={inter.className}>
        <Script
          id="restai-theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: THEME_INIT }}
        />
        <Providers>
          {children}
          {/* `theme="system"` deja que el toaster siga la clase del <html>, en
              vez de quedarse siempre oscuro sobre una interfaz clara. */}
          <Toaster position="bottom-right" theme="system" richColors />
        </Providers>
      </body>
    </html>
  );
}
