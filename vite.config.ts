import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // No build de biblioteca (widget IIFE) o Vite NÃO injeta process.env.NODE_ENV
  // automaticamente como faz no build de app. Dependências (React e afins) leem
  // `process.env.NODE_ENV`, e no navegador `process` não existe → o widget
  // estourava com "ReferenceError: process is not defined" antes de montar a
  // bolha. Substituímos a expressão em tempo de build para o widget.
  define: mode === "widget"
    ? { "process.env.NODE_ENV": JSON.stringify("production") }
    : {},
  build: mode === "widget"
    ? {
        // ── Widget embed build ────────────────────────────────────────────────
        // Run with: VITE_MODE=widget npm run build:widget
        lib: {
          entry: path.resolve(__dirname, "src/widget-embed/index.tsx"),
          name: "CloudDeskWidget",
          formats: ["iife"],
          fileName: () => "widget.js",
        },
        outDir: "dist-widget",
        emptyOutDir: true,
        rollupOptions: {
          // Bundle everything — host site has no React
          external: [],
          output: {
            // Inline all assets (CSS via style injection)
            inlineDynamicImports: true,
          },
        },
      }
    : {
        // ── Main app build (default) ──────────────────────────────────────────
        outDir: "dist",
      },
}));
