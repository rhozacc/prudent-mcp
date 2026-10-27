#!/usr/bin/env bun
/**
 * Bundles src/mcpb-entry.ts → dist/mcpb/server/index.mjs, copies the
 * manifest and icon, then invokes @anthropic-ai/mcpb pack.
 *
 *   bun run build:mcpb
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { bundleServer } from "./bundle-server.ts";

const OUT_DIR = "dist/mcpb";
const SERVER_DIR = join(OUT_DIR, "server");

mkdirSync(SERVER_DIR, { recursive: true });

console.log("Bundling server…");
await bundleServer(join(SERVER_DIR, "index.mjs"));

copyFileSync("manifest.json", join(OUT_DIR, "manifest.json"));
copyFileSync("docs/public/prudent-logo.png", join(OUT_DIR, "icon.png"));
// The bundle is a redistribution, so it carries its own licence terms and the
// notices for what is linked into it.
copyFileSync("LICENSE", join(OUT_DIR, "LICENSE"));
copyFileSync("THIRD-PARTY-NOTICES.md", join(OUT_DIR, "THIRD-PARTY-NOTICES.md"));

console.log("Packing .mcpb…");
execSync("npx --yes @anthropic-ai/mcpb pack dist/mcpb", { stdio: "inherit" });

console.log("Done. Install by dragging the .mcpb file onto Claude Desktop.");
