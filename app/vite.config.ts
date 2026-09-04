import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

// `@inference-market/client` is a workspace package published as raw TypeScript,
// so it is resolved through its real path and compiled as app source rather than
// pre-bundled. `server.fs.allow` lets the dev server read it from outside `app/`.
//
// There is deliberately no `define: { "process.env": {} }` here. That define
// lands a bare `{ env: {} }` on `globalThis.process`, which then wins the
// `globalThis.process || shim` guard the polyfill injects, so `process.browser`
// and `process.version` are missing and `readable-stream` (pulled in by
// ripemd160, under the ephemeral-rollups SDK) throws before React ever mounts.
// The polyfill's own process shim already answers `process.env.BASE_URL` with
// undefined, which is what the client's fallbacks expect.
export default defineConfig({
  plugins: [react(), nodePolyfills({ include: ["buffer", "crypto", "stream"] })],
  optimizeDeps: { exclude: ["@inference-market/client"] },
  server: { fs: { allow: [".."] } },
  build: {
    rollupOptions: {
      output: {
        // Anchor plus web3.js dwarfs the app itself; splitting them keeps the
        // UI chunk small enough to re-download on its own after an edit.
        manualChunks: {
          react: ["react", "react-dom", "framer-motion"],
          solana: ["@solana/web3.js", "@coral-xyz/anchor"],
        },
      },
    },
  },
});
