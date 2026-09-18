/**
 * Eval harness — drives the REAL server over stdio and records what a consuming
 * model actually receives.
 *
 * The unit of measurement is the **call trace**: for every tool call, the bytes
 * and estimated tokens that land in the model's context, the latency, and
 * whether the call errored. Everything in `invariants.ts` is expressed over
 * traces, so a quality claim is always tied to an observation rather than to
 * a reading of the source.
 *
 * Corpus-agnostic by construction: the harness spawns whatever CORPUS_FILE
 * points at (the demo adapters when unset), so the same checks run in CI on the
 * open-source demo corpus and locally against a real one. No corpus content
 * lives here.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// ============================================================================
// Token accounting
// ============================================================================

/**
 * chars/4 — the standard rough proxy. JSON with many short keys tokenizes
 * denser than prose, so this UNDER-states the true cost if anything; a budget
 * that fails under this estimate fails harder in reality. Used for ranking and
 * for budget assertions, never reported as an exact figure.
 */
export const estimateTokens = (s: string): number => Math.round(s.length / 4);

// ============================================================================
// Traces
// ============================================================================

export interface CallTrace {
  tool: string;
  args: Record<string, unknown>;
  /** Concatenated text content — exactly what reaches the model's context. */
  text: string;
  chars: number;
  tokens: number;
  ms: number;
  isError: boolean;
  /** Parsed body when the content is valid JSON; null when it is not. */
  json: unknown | null;
}

export interface ToolCard {
  name: string;
  description: string;
  /**
   * The serialized input schema. Kept, not just measured: per-field
   * `describe()` text is part of what the model is told, so anything asserted
   * about a tool's description has to be asserted about this too.
   */
  schemaText: string;
  schemaChars: number;
  /** Standing cost of publishing this tool, paid on every request. */
  tokens: number;
  /**
   * The published OUTPUT schema, when the tool declares one. Not counted toward
   * `tokens`: a client validates against it but a model is never shown it.
   * Kept so the suite can check that what a handler actually returns is what the
   * tool says it returns — drift `tsc` cannot see, because a body assembled by
   * spread satisfies the handler's return type while carrying keys the
   * published schema never names.
   */
  outputSchema?: unknown;
}

export interface Session {
  tools: ToolCard[];
  /**
   * MODEL-VISIBLE standing cost before any call: tool cards plus the server's
   * `instructions`. This is what a budget should bound — it is what the model
   * actually pays.
   */
  surfaceTokens: number;
  /**
   * Everything the surface puts on the wire, including the output schemas a
   * client may validate against but no model is shown. Reported, never gated:
   * budgeting it would make "reduce the surface" mean deleting bytes that cost
   * the model nothing.
   */
  wireTokens: number;
  /** The server's instructions block, counted inside surfaceTokens. */
  instructions: string;
  call(tool: string, args?: Record<string, unknown>): Promise<CallTrace>;
  traces: CallTrace[];
  close(): Promise<void>;
}

// ============================================================================
// Session
// ============================================================================

export interface OpenOptions {
  /** Path to a corpus JSON file. Omitted → the seeded in-memory demo. */
  corpusFile?: string;
  /** Server entry point; defaults by whether a corpus file was given. */
  entry?: string;
  command?: string;
}

/**
 * With no corpus file the default entry is the **seeded demo**, not the MCPB
 * entry: the MCPB entry with no CORPUS_FILE serves empty adapters, against
 * which every invariant has nothing to bind and the suite passes without
 * measuring anything. Defaulting to a seeded server keeps CI honest.
 */
export async function openSession(opts: OpenOptions = {}): Promise<Session> {
  const fallback =
    opts.corpusFile === undefined ? "../examples/inmemory-demo.ts" : "../src/mcpb-entry.ts";
  const entry = opts.entry ?? new URL(fallback, import.meta.url).pathname;
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  if (opts.corpusFile !== undefined) env["CORPUS_FILE"] = opts.corpusFile;

  const transport = new StdioClientTransport({
    command: opts.command ?? "bun",
    args: [entry],
    env,
  });
  const client = new Client({ name: "prudent-evals", version: "0" }, { capabilities: {} });
  await client.connect(transport);

  const listed = await client.listTools();
  const tools: ToolCard[] = listed.tools.map((t) => {
    const description = t.description ?? "";
    const schemaText = JSON.stringify(t.inputSchema);
    const schemaChars = schemaText.length;
    const out = (t as { outputSchema?: unknown }).outputSchema;
    return {
      name: t.name,
      description,
      schemaText,
      schemaChars,
      tokens: estimateTokens("x".repeat(t.name.length + description.length + schemaChars)),
      ...(out === undefined ? {} : { outputSchema: out }),
    };
  });
  // MODEL-VISIBLE standing cost: the tool cards a client puts in the prompt,
  // plus the server's `instructions`, which every client is told to surface and
  // which this one can read back. That is what the model pays before a single
  // question is asked, and it is the number to budget.
  //
  // Output schemas, resource templates and prompt scaffolds are deliberately
  // NOT in it. They cross the wire and a client may validate against them, but
  // no model is shown them, so folding them in would inflate the budget with
  // bytes the model never sees — and then "reduce the surface" would mean
  // deleting things that cost the model nothing. They are reported separately.
  const instructions = client.getInstructions() ?? "";
  const toolTokens = tools.reduce((n, t) => n + t.tokens, 0);
  const surfaceTokens = toolTokens + estimateTokens(instructions);
  const wireTokens =
    surfaceTokens +
    tools.reduce(
      (n, t) => n + (t.outputSchema === undefined ? 0 : estimateTokens(JSON.stringify(t.outputSchema))),
      0,
    );

  const traces: CallTrace[] = [];

  const call = async (tool: string, args: Record<string, unknown> = {}): Promise<CallTrace> => {
    const t0 = performance.now();
    let text = "";
    let isError = false;
    try {
      const r = (await client.callTool({ name: tool, arguments: args })) as {
        content?: Array<{ type: string; text?: string }>;
        isError?: boolean;
      };
      text = (r.content ?? []).map((c) => c.text ?? "").join("");
      isError = r.isError === true;
    } catch (e) {
      // A protocol-level rejection (bad arguments) is a real thing a model does;
      // record it as an errored trace rather than throwing the run away.
      text = e instanceof Error ? e.message : String(e);
      isError = true;
    }
    let json: unknown | null = null;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = null;
    }
    const trace: CallTrace = {
      tool,
      args,
      text,
      chars: text.length,
      tokens: estimateTokens(text),
      ms: Math.round(performance.now() - t0),
      isError,
      json,
    };
    traces.push(trace);
    return trace;
  };

  return {
    tools,
    surfaceTokens,
    wireTokens,
    instructions,
    call,
    traces,
    close: () => client.close(),
  };
}

// ============================================================================
// Findings
// ============================================================================

export type Severity = "fatal" | "warn" | "info";

export interface Finding {
  id: string;
  severity: Severity;
  /** One sentence: what is wrong, in terms of what a model would believe. */
  summary: string;
  /** The observation that proves it — a value, not a re-assertion. */
  evidence: string[];
}

export interface InvariantResult {
  id: string;
  title: string;
  /** false when the invariant could not bind — reported, never silently passed. */
  applicable: boolean;
  findings: Finding[];
}

export const passed = (r: InvariantResult): boolean =>
  r.applicable && r.findings.every((f) => f.severity !== "fatal");
