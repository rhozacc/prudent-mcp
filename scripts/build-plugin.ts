#!/usr/bin/env bun
/**
 * Builds the Claude Code plugin in plugin/ from the source: the bundled server (plugin/server/index.mjs), and the
 * licence and notices that travel with it. The rest of plugin/ (plugin.json, .mcp.json, README) is written
 * by hand. A plugin is installed from git with no build step, so the bundle is committed, and tests/plugin.test.ts
 * fails when it is not the build of the current source.
 *
 *   bun run build:plugin
 */
import { copyFileSync, mkdirSync } from "node:fs";
import { bundleServer } from "./bundle-server.ts";

mkdirSync("plugin/server", { recursive: true });
console.log("Bundling plugin/server/index.mjs…");
await bundleServer("plugin/server/index.mjs");
copyFileSync("LICENSE", "plugin/LICENSE");
copyFileSync("THIRD-PARTY-NOTICES.md", "plugin/THIRD-PARTY-NOTICES.md");
console.log("Done. Commit plugin/.");
