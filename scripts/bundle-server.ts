/**
 * The one definition of how this server is bundled into a single Node file.
 * `build-mcpb.ts` (Claude Desktop) and `build-plugin.ts` (Claude Code plugin) both use it, so the two
 * artifacts are the same server. Bundling statically links two MIT dependencies (zod and the MCP SDK),
 * and MIT requires their notices to travel with the copy: THIRD-PARTY-NOTICES.md is what discharges that
 * (neither package ships a legal banner today), and `legalComments: "eof"` keeps one if a future dependency does.
 * `node:*` built-ins are externalized by esbuild. Pure JS, no native modules: the bundle runs on plain Node 18+.
 */
import { build, type BuildOptions, type Plugin } from "esbuild";
import { resolve } from "node:path";

/**
 * The SDK's default JSON Schema validator (Ajv) is only reached by elicitation, which this read-only server never
 * does; see scripts/stubs/ajv-provider.ts. Leaving it out removes Ajv and its dependencies from the bundle.
 */
const withoutAjvValidator: Plugin = {
  name: "without-ajv-validator",
  setup(b) {
    b.onResolve({ filter: /validation\/ajv-provider\.js$/ }, () => ({ path: resolve("scripts/stubs/ajv-provider.ts") }));
  },
};

export const serverBundleOptions = (outfile: string): BuildOptions => ({
  entryPoints: ["src/mcpb-entry.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile,
  target: "node18",
  legalComments: "eof",
  plugins: [withoutAjvValidator],
  // Reproducible: no absolute paths or timestamps in the output.
  logLevel: "warning",
});

export const bundleServer = (outfile: string) => build(serverBundleOptions(outfile));
