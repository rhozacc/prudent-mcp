// Rough timing of the citation resolver on a synthetic corpus (no real text).
// `bun run scripts/bench-cite.ts [records] [citations]`
import { resolveCitationDetailed } from "../src/citation/index.ts";
import type { Regulation } from "../src/schema.ts";

const n = Number(process.argv[2] ?? 3000);
const calls = Number(process.argv[3] ?? 200);
const docs = 40;
const regulations = Array.from({ length: n }, (_, i) => {
  const doc = i % docs;
  const art = Math.floor(i / docs) + 1;
  return {
    id: `regulation://synth/doc-${doc}/article-${art}`,
    framework: "synth",
    document_id: `synth-doc-${doc}`,
    document_version: "2024-01-01",
    citation: `Synthetic Article ${art}(${(i % 5) + 1})`,
    citation_aliases: [`Art. ${art}.${(i % 5) + 1}`],
    text: `Synthetic text ${i}.`,
  } as unknown as Regulation;
});
const asks = Array.from({ length: calls }, (_, k) => {
  const doc = k % docs;
  const art = (k * 7) % Math.floor(n / docs) + 1;
  // hits, aliases, scoped misses and a regulation-number instrument that forces the retry
  return [
    `synth-doc-${doc} Article ${art}(1)`,
    `Art. ${art}.2`,
    `Article ${art}(4) of Regulation (EU) No 575/2013`,
    `Article 999${k}`,
  ][k % 4]!;
});
const t0 = performance.now();
let matched = 0;
const all: unknown[] = [];
for (const a of asks) {
  const r = resolveCitationDetailed(regulations, a);
  if (r.match !== null) matched++;
  all.push(r);
}
const ms = performance.now() - t0;
console.log(`${calls} citations over ${n} records: ${ms.toFixed(0)} ms (${(ms / calls).toFixed(2)} ms each), ${matched} matched, results hash ${Bun.hash(JSON.stringify(all)).toString(16)}`);
