import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

// Two consumption modes:
//  - npm:        `tsc` emits dist/*.js with `preact` as a normal import
//                (the consumer's bundler dedupes it).
//  - standalone: this Vite lib build emits a single self-registering ESM bundle
//                with Preact INLINED, served at a stable URL and loaded via
//                `<script type="module" src="…/baobox-skill-builder.js">`.
export default defineConfig({
  plugins: [preact()],
  build: {
    outDir: "dist/standalone",
    emptyOutDir: true,
    lib: {
      entry: "src/standalone.ts",
      formats: ["es"],
      fileName: () => "baobox-skill-builder.js",
    },
    // No `rollupOptions.external` → Preact + the contract are bundled in, so the
    // file is fully self-contained (the browser loads nothing else).
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["test/**/*.test.{ts,tsx}"],
  },
});
