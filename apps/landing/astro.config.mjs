// @ts-check
import { defineConfig } from "astro/config";

// Landing 100% estática (SSG). Despliegue: Cloudflare Workers Static Assets en
// el apex restai.bezenti.com. La app (dashboard) vive en app.restai.bezenti.com
// y la API en api.restai.bezenti.com.
export default defineConfig({
  site: "https://restai.bezenti.com",
  output: "static",
  trailingSlash: "never",
});
