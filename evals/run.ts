/**
 * Eval runner — evaluates every invariant against a served corpus and prints a
 * report. Exit 0 when no fatal finding survives, 1 otherwise.
 *
 *   bun run evals                                  # demo adapters
 *   CORPUS_FILE=/path/to/corpus.json bun run evals # a real corpus
 *   bun run evals --json                           # machine-readable
 */
import { openSession, runInvariants, type Session } from "./harness.ts";
import { ALL } from "./invariants.ts";

const asJson = process.argv.includes("--json");
const corpusFile = process.env["CORPUS_FILE"];

async function main(): Promise<void> {
  const session: Session = await openSession(
    corpusFile === undefined ? {} : { corpusFile },
  );

  const { results, costs } = await runInvariants(session, ALL);

  const totalCalls = session.traces.length;
  const totalTokens = session.traces.reduce((n, t) => n + t.tokens, 0);
  await session.close();

  const fatal = results.flatMap((r) => r.findings.filter((f) => f.severity === "fatal"));
  const warn = results.flatMap((r) => r.findings.filter((f) => f.severity === "warn"));
  const inapplicable = results.filter((r) => !r.applicable);

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          corpus: corpusFile ?? "(demo adapters)",
          surface_tokens: session.surfaceTokens,
          tools: session.tools.length,
          calls: totalCalls,
          tokens_observed: totalTokens,
          // calls and tokens observed by each invariant's own probes; they sum to `calls` and `tokens_observed`.
          by_invariant: costs,
          results,
        },
        null,
        2,
      ),
    );
    process.exit(fatal.length > 0 ? 1 : 0);
  }

  console.log(`# prudent context evals\n`);
  console.log(`corpus: ${corpusFile ?? "(demo adapters — set CORPUS_FILE for a real one)"}`);
  console.log(`tools published: ${session.tools.length} · standing surface cost ~${session.surfaceTokens} tokens`);
  console.log(`observed: ${totalCalls} calls, ~${totalTokens} tokens\n`);

  for (const [i, r] of results.entries()) {
    const bad = r.findings.filter((f) => f.severity === "fatal").length;
    const meh = r.findings.filter((f) => f.severity === "warn").length;
    const mark = !r.applicable ? "n/a " : bad > 0 ? "FAIL" : meh > 0 ? "warn" : "pass";
    const cost = costs[i];
    console.log(`${mark}  ${r.id}  ${r.title}${cost === undefined || cost.calls === 0 ? "" : `  (${cost.calls} calls, ~${cost.tokens_observed} tokens)`}`);
    for (const f of r.findings) {
      const sev = f.severity === "fatal" ? "✗" : f.severity === "warn" ? "⚠" : "·";
      console.log(`      ${sev} ${f.summary}`);
      for (const e of f.evidence) console.log(`          ${e}`);
    }
  }

  console.log("");
  if (inapplicable.length > 0) {
    console.log(`⚠ ${inapplicable.length} invariant(s) had nothing to bind on: ${inapplicable.map((r) => r.id).join(", ")}`);
  }

  // A suite that passes because it measured nothing is the failure it exists to
  // catch. Serving an empty corpus must fail the run, not sail through it.
  const vacuous = inapplicable.length === results.length;
  if (vacuous) {
    console.log("✗ every invariant was inapplicable — the server under test served nothing to measure.");
  }

  console.log(`${fatal.length} fatal · ${warn.length} warning(s)`);
  process.exit(fatal.length > 0 || vacuous ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
