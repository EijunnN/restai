import type { Metadata } from "next";
import { Inter } from "next/font/google";
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
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT }} />
      </head>
      <body className={inter.className}>
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
