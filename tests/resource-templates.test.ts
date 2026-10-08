/**
 * tests/resource-templates.test.ts — every surface's resource template must
 * match the ids that surface actually mints.
 *
 * WHY THIS EXISTS. `test://` was registered as `test://{id}` — a SIMPLE RFC
 * 6570 variable, which by spec cannot match a `/`. The other four surfaces use
 * `{+path}` (reserved expansion), which can. Every test id in the real corpus
 * is two-segment (`test://gl-2019-03/downturn-lgd-vs-reference-value`), so
 * `resources/read` could never resolve a single one of the 284 of them.
 *
 * The suite did not catch it because the in-memory demo — the reference corpus
 * every wire test runs against — seeds SINGLE-segment test ids
 * (`test://jeffreys`). A single segment matches `{id}` perfectly, so the demo
 * masked a total failure of that surface on any real corpus.
 *
 * These tests therefore use two-segment ids for EVERY surface, which is the
 * shape the corpus actually produces.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { adapters } from "../src/adapters.ts";
import { createFileAdapters, loadCorpusFile } from "../src/file-adapter.ts";
import { createServer } from "../src/server.ts";

const dir = mkdtempSync(join(tmpdir(), "prudent-restmpl-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Two segments on every surface — what the linker actually mints. */
const corpus = {
  regulation: [
    {
      id: "regulation://gl-2019-03/article-13",
      framework: "eba",
      document_id: "eba-gl-2019-03",
      document_version: "2019-03-06",
      citation: "EBA/GL/2019/03 para. 13",
      text: "For the purpose of quantifying LGDs appropriate for an economic downturn.",
      children: [],
    },
  ],
  tests: [
    {
      id: "test://gl-2019-03/downturn-lgd-vs-reference-value-comparison",
      name: "Downturn LGD vs reference value",
      aliases: [],
      purpose: "Compare the final downturn LGD against the reference value.",
      regulatory_basis: ["regulation://gl-2019-03/article-13"],
      last_updated: "2026-09-01",
    },
  ],
  checks: [
    {
      id: "check://gl-2019-03/GL-4-downturn-lgd-calibration-level",
      name: "Downturn LGD calibration level",
      derived_from: ["regulation://gl-2019-03/article-13"],
      expectation: "Calibrate at least at the level of the long-run average LGD.",
      expected_evidence: ["calibration documentation"],
      last_updated: "2026-09-01",
    },
  ],
  playbooks: [
    {
      id: "playbook://downturn-lgd",
      title: "Downturn LGD",
      area: "lgd",
      summary: "Calibrate to the downturn.",
      questions: ["How is downturn LGD calibrated?"],
      basis: [],
      requirements: [{ id: "R1", title: "Calibrate", statement: "Calibrate at the long-run average level at least.", provisions: [{ id: "regulation://gl-2019-03/article-13" }] }],
      provenance: { status: "approved", compiled_at: "2026-09-01T00:00:00Z", inputs_sha: "0".repeat(64) },
    },
  ],
  sources: [
    {
      id: "source://eba/gl-2019-03",
      title: "Downturn LGD guidelines",
      framework: "eba",
      document_id: "eba-gl-2019-03",
      doc_type: "guideline",
      status: "current",
      verified: "2026-09-01",
      milestones: [],
    },
  ],
};

/** Each surface's two-segment id, and the tool to fall back to on a miss. */
const CASES = [
  ["regulation://gl-2019-03/article-13", "regulation"],
  ["test://gl-2019-03/downturn-lgd-vs-reference-value-comparison", "test"],
  ["check://gl-2019-03/GL-4-downturn-lgd-calibration-level", "check"],
  ["playbook://downturn-lgd", "playbook"],
  ["source://eba/gl-2019-03", "source"],
] as const;

describe("resource templates match real, multi-segment ids", () => {
  let client: import("@modelcontextprotocol/sdk/client/index.js").Client;
  const saved = { ...adapters };

  beforeAll(async () => {
    const fa = createFileAdapters(loadCorpusFile(writeFixture()));
    adapters.regulation = fa.regulation;
    adapters.test = fa.test;
    adapters.check = fa.check;
    adapters.playbook = fa.playbook;
    adapters.source = fa.source;
    adapters.meta = fa.meta;

    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await createServer().connect(serverTransport);
    client = new Client({ name: "resource-template-test", version: "0.0.0" });
    await client.connect(clientTransport);
  });

  afterAll(() => {
    Object.assign(adapters, saved);
  });

  function writeFixture(): string {
    const path = join(dir, "two-segment.json");
    writeFileSync(path, JSON.stringify(corpus, null, 2));
    return path;
  }

  for (const [uri, surface] of CASES) {
    it(`reads ${surface} at ${uri.split("://")[0]}://{two}/{segments}`, async () => {
      // Before the fix this REJECTED for test:// alone, with the SDK unable to
      // match the uri against any registered template.
      const res = await client.readResource({ uri });
      const text = (res.contents[0] as { text: string }).text;
      // A playbook is read as rendered text; every other entry as its JSON.
      if (surface === "playbook") expect(text).toContain("# Downturn LGD");
      else expect(JSON.parse(text).id).toBe(uri);
    });
  }

  it("still surfaces a genuine miss as -32002 rather than matching nothing", async () => {
    // The fix must not turn "no such record" into "no such template": a miss
    // has to keep pointing the caller at the right search tool.
    expect(
      client.readResource({ uri: "test://gl-2019-03/no-such-test-anywhere" }),
    ).rejects.toMatchObject({ code: -32002 });
  });
});
