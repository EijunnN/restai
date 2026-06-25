// Rasteriza public/og.svg → public/og.png (imagen Open Graph para redes).
// Uso: `bun run gen:og` cuando cambies og.svg. El PNG se commitea como asset
// estático, así que el build/CI NO necesita rasterizar nada.
import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync } from "node:fs";

const svg = readFileSync(new URL("../public/og.svg", import.meta.url));
const resvg = new Resvg(svg, {
  fitTo: { mode: "width", value: 1200 },
  font: { loadSystemFonts: true },
});
writeFileSync(new URL("../public/og.png", import.meta.url), resvg.render().asPng());
console.log("✓ public/og.png generado");
