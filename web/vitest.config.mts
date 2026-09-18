import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const resolve = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Matches the "paths" entry in tsconfig.json. Without it a test can only
      // import by relative path, which quietly limits what is testable.
      "@": resolve("./src"),
      // `server-only` throws on import unless the bundler selected its
      // "react-server" export condition, which Next does for server code and
      // vitest does not do at all. Point it at the package's own no-op entry so
      // a module carrying the guard stays testable. Resolved as a file path
      // because the package's `exports` map does not publish the subpath.
      "server-only": resolve("./node_modules/server-only/empty.js"),
    },
  },
});
