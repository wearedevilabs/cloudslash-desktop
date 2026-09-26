import { writeFileSync } from "node:fs";
import { defineConfig } from "vite";

// The bundle is served by the Wails asset server, which mounts the embedded
// filesystem at the web root. Relative asset URLs keep the bundle working both
// under the desktop webview and when previewed over plain HTTP.
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    assetsInlineLimit: 0,
  },
  plugins: [
    {
      // emptyOutDir clears dist on every build, but main.go embeds that
      // directory and Go refuses to embed a directory with no files in it.
      // Re-create the placeholder after the bundle is written.
      name: "keep-dist-placeholder",
      closeBundle() {
        writeFileSync(new URL("./dist/.gitkeep", import.meta.url), "");
      },
    },
  ],
  server: {
    port: 9245,
    strictPort: true,
  },
});
