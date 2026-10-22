import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bundleServer } from "../scripts/bundle-server.ts";

/**
 * The Claude Code plugin in plugin/ (installed from git, so the bundle is committed). These tests are what keeps
 * it submittable: a manifest the directory's checks accept, a server file that is the build of the current
 * source, and a server that starts under plain Node with the setting empty or unfilled.
 */
const read = (p: string): string => readFileSync(p, "utf8");
const json = (p: string): any => JSON.parse(read(p));
const manifest = json("plugin/.claude-plugin/plugin.json");
const mcp = json("plugin/.mcp.json");

describe("plugin manifest", () => {
  test("has the fields the directory checks, and a name that is not an Anthropic one", () => {
    expect(manifest.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(manifest.name).not.toMatch(/^(claude|anthropic|anthropics|cc-plugin)(-|$)|official/i);
    for (const k of ["version", "description", "license", "repository", "homepage"]) expect(typeof manifest[k]).toBe("string");
    expect(manifest.author.name).toBeTruthy();
    expect(manifest.license).toBe("AGPL-3.0-only");
    for (const k of ["homepage", "repository", "documentationUrl", "supportUrl"]) expect(() => new URL(manifest[k])).not.toThrow();
  });

  test("its version is the package's and the Desktop manifest's, so a release cannot move one", () => {
    expect(manifest.version).toBe(json("package.json").version);
    expect(manifest.version).toBe(json("manifest.json").version);
  });

  test("userConfig options carry the three required keys", () => {
    for (const [key, o] of Object.entries<any>(manifest.userConfig)) {
      expect(key).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
      expect(["string", "number", "boolean", "directory", "file"]).toContain(o.type);
      expect(o.title && o.description).toBeTruthy();
    }
  });
});

describe("plugin .mcp.json", () => {
  const server = mcp.mcpServers.prudent;

  test("runs a bundled file with node, not through a package manager", () => {
    expect(server.command).toBe("node");
    expect(server.args).toEqual(["${CLAUDE_PLUGIN_ROOT}/server/index.mjs"]);
    expect(read("plugin/server/index.mjs").length).toBeGreaterThan(1000);
  });

  test("every ${user_config.KEY} it uses is declared by the manifest", () => {
    const used = [...JSON.stringify(mcp).matchAll(/\$\{user_config\.([A-Za-z0-9_]+)\}/g)].map((m) => m[1]!);
    expect(used.length).toBeGreaterThan(0);
    for (const k of used) expect(Object.keys(manifest.userConfig)).toContain(k);
  });
});

describe("plugin bundle", () => {
  test("is the build of the current source (run `bun run build:plugin`)", async () => {
    const out = join(mkdtempSync(join(tmpdir(), "plugin-bundle-")), "index.mjs");
    await bundleServer(out);
    expect(read("plugin/server/index.mjs") === read(out)).toBe(true);
  });

  test("leaves out the validator nothing here uses, and with it Ajv and its stray URLs", () => {
    const bundle = read("plugin/server/index.mjs");
    expect(bundle).not.toMatch(/raw\.githubusercontent\.com|ajv-validator/);
    expect(bundle).not.toMatch(/class Ajv\b|new Ajv\b/);
    // and the code that would use it is not reachable from this server
    expect(readFileSync("src/server.ts", "utf8")).not.toMatch(/elicit/i);
  });

  test("has no network or process code: its only built-ins are process and fs (the README tells reviewers so)", () => {
    const bundle = read("plugin/server/index.mjs");
    const builtins = new Set([...bundle.matchAll(/\bfrom\s+"(node:[a-z_/]+)"/g)].map((m) => m[1]));
    expect([...builtins].sort()).toEqual(["node:fs", "node:process"]);
    expect(bundle).not.toMatch(/\bfetch\(|new WebSocket|XMLHttpRequest|child_process|node:(https?|net|tls|dgram)/);
  });

  test("carries the licence and the third-party notices of what it links", () => {
    expect(read("plugin/LICENSE")).toBe(read("LICENSE"));
    expect(read("plugin/THIRD-PARTY-NOTICES.md")).toBe(read("THIRD-PARTY-NOTICES.md"));
  });

  const node = Bun.which("node");
  const handshake = async (corpusFile: string | undefined): Promise<string[]> => {
    const env: Record<string, string> = { ...(process.env as Record<string, string>) };
    delete env["CORPUS_FILE"];
    if (corpusFile !== undefined) env["CORPUS_FILE"] = corpusFile;
    const proc = Bun.spawn([node!, "plugin/server/index.mjs"], { env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    const send = (m: object) => proc.stdin.write(`${JSON.stringify(m)}\n`);
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } } });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    proc.stdin.flush();
    let text = "";
    const reader = proc.stdout.getReader();
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && !text.includes('"id":2')) {
      const { value, done } = await Promise.race([reader.read(), new Promise<{ value: undefined; done: true }>((r) => setTimeout(() => r({ value: undefined, done: true }), 500))]);
      if (value) text += new TextDecoder().decode(value);
      if (done && !text.includes('"id":2')) continue;
    }
    proc.kill();
    const line = text.split("\n").find((l) => l.includes('"id":2'));
    return (JSON.parse(line ?? "{}").result?.tools ?? []).map((t: { name: string }) => t.name);
  };

  for (const [label, value] of [["unset", undefined], ["empty", ""], ["an unfilled placeholder", "${user_config.corpusFile}"]] as const) {
    test.skipIf(node === null)(`starts under node and lists the eight tools with CORPUS_FILE ${label}`, async () => {
      expect((await handshake(value)).sort()).toEqual(["brief", "cite", "get", "playbook", "related", "search", "sources", "topics"]);
    });
  }
});
