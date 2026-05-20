#!/usr/bin/env bun
/**
 * Bundles src/mcpb-entry.ts → dist/mcpb/server/index.mjs, copies the
 * manifest and icon, then invokes @anthropic-ai/mcpb pack.
 *
 *   bun run build:mcpb
 */
import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const OUT_DIR = "dist/mcpb";
const SERVER_DIR = join(OUT_DIR, "server");

mkdirSync(SERVER_DIR, { recursive: true });

console.log("Bundling server…");
await build({
  entryPoints: ["src/mcpb-entry.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: join(SERVER_DIR, "index.mjs"),
  target: "node18",
  // zod and @modelcontextprotocol/sdk are pure-JS — bundle them in.
  // node:* built-ins are automatically externalized by esbuild.
});

copyFileSync("manifest.json", join(OUT_DIR, "manifest.json"));
copyFileSync("prudent-logo.png", join(OUT_DIR, "icon.png"));

console.log("Packing .mcpb…");
execSync("npx --yes @anthropic-ai/mcpb pack dist/mcpb", { stdio: "inherit" });

console.log("Done. Install by dragging the .mcpb file onto Claude Desktop.");
