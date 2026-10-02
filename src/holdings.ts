/**
 * The ONE definition of what the corpus holds of each document, and of how a
 * miss talks about it.
 *
 * `get_corpus_info.coverage` names documents ("CRR"), which reads as the whole
 * regulation; a corpus holds a subset of its articles. A miss ("No record for
 * ...") and a citation decline ("Nothing in this corpus is numbered 153") are
 * both TRUE and both read as "there is no Article 153". Absence from the corpus
 * is not absence from the law, and the only party that can say which kind of
 * absence a miss is, is the registry that knows how much of the document was
 * taken. So the file adapter, the in-memory demo, the tool-layer misses,
 * resolve_citation and the linter all delegate here, the way every adapter's
 * reverse index delegates to `computeReferrers`.
 *
 * Pure over the supplied arrays: no I/O, no adapter handles.
 */
import type { DocumentHolding, Regulation, RegulationId, Source } from "./schema.ts";

/**
 * First path segment of a regulation id: the document as the id spells it, not
 * the framework and not `document_id` (`egim` against `ecb-guide-internal-models`).
 * The file adapter's citation scoping and the misses below both need exactly
 * this notion of "which document is this id in", so it is defined once.
 */
export const idDocSegment = (id: string): string =>
  id.replace(/^regulation:\/\//, "").split("/")[0] ?? "";

/**
 * What the registry declares about one document, or `undefined` for NOT
 * DECLARED.
 *
 * Only a CURRENT source speaks for the document: a superseded or pending
 * source describes another edition. When a document has several current sources
 * and their declarations conflict, PARTIAL WINS. The two errors are not
 * symmetric: reading a partly held document as whole tells a caller that a
 * missing provision does not exist, which is the untruth this module is here to
 * prevent, while reading a whole document as partial costs one over-cautious
 * sentence.
 */
function declaredPartial(current: Source[]): boolean | undefined {
  const declared = current.flatMap((s) => (s.coverage === undefined ? [] : [s.coverage]));
  if (declared.includes("partial")) return true;
  if (declared.includes("full")) return false;
  return undefined;
}

/**
 * Per-document holdings: one entry per document that has at least one
 * regulation record, in order of first appearance. The join to the registry is
 * `framework` + `document_id` string equality, as everywhere else — sources are
 * not referenced by id.
 *
 * `partial` is set only when a current source declares: true for partial, false
 * for full, the KEY ABSENT when nothing was declared (absent is not "full").
 */
export function computeHoldings(regulations: Regulation[], sources: Source[]): DocumentHolding[] {
  const docs = new Map<string, { framework: string; document_id: string; records: number }>();
  for (const r of regulations) {
    const key = `${r.framework}\u0000${r.document_id}`;
    const slot = docs.get(key);
    if (slot === undefined) docs.set(key, { framework: r.framework, document_id: r.document_id, records: 1 });
    else slot.records++;
  }
  return [...docs.values()].map((d) => {
    const matching = sources.filter((s) => s.framework === d.framework && s.document_id === d.document_id);
    const current = matching.filter((s) => s.status === "current");
    const title = (current[0] ?? matching[0])?.title;
    const partial = declaredPartial(current);
    return {
      document_id: d.document_id,
      framework: d.framework,
      ...(title === undefined ? {} : { title }),
      records: d.records,
      ...(partial === undefined ? {} : { partial }),
    };
  });
}

const nameOf = (h: DocumentHolding): string => h.title ?? h.document_id;
const recordsOf = (n: number): string => `${n} record${n === 1 ? "" : "s"}`;

/**
 * The clause every partial-document decline shares. One sentence, so a miss and
 * a citation note cannot drift into saying different things about the same
 * document.
 */
export function partialClause(h: DocumentHolding): string {
  return (
    `This corpus holds only part of ${nameOf(h)} (${recordsOf(h.records)}), so a provision ` +
    "missing here is absent from the corpus, not necessarily from the law."
  );
}

/**
 * The clause for a citation that names no document, when some held document is
 * partial: the citation may be to any of them, so name which.
 */
export function partialDocumentsClause(holdings: DocumentHolding[]): string | null {
  const partial = holdings.filter((h) => h.partial === true);
  if (partial.length === 0) return null;
  return (
    `This corpus holds only part of ${partial.map(nameOf).join("; ")}, so if the citation is to ` +
    "one of those, a provision missing here is absent from the corpus, not necessarily from the law."
  );
}

/**
 * The partial clause that applies to a citation scoped to `docs` (document ids
 * it names), or, when it names none, to any partial held document. Null when
 * nothing partial is in play or no holdings were supplied.
 */
export function citationPartialClause(
  holdings: DocumentHolding[] | undefined,
  docs: ReadonlySet<string> | null,
): string | null {
  if (holdings === undefined) return null;
  if (docs === null) return partialDocumentsClause(holdings);
  const named = holdings.filter((h) => docs.has(h.document_id) && h.partial === true);
  return named.length === 0 ? null : named.map(partialClause).join(" ");
}

// Conservative order when one id segment maps to several documents: the reading
// that warns the most wins.
const rank = (h: DocumentHolding): number => (h.partial === true ? 0 : h.partial === undefined ? 1 : 2);

/**
 * The holding an id's first path segment belongs to: the document whose records
 * carry that segment, else the document whose `document_id` it spells. Null when
 * no held document answers to it.
 */
export function holdingForId(
  regulations: Regulation[],
  holdings: DocumentHolding[],
  id: RegulationId | string,
): DocumentHolding | null {
  const segment = idDocSegment(id);
  if (segment === "") return null;
  const docIds = new Set(
    regulations.filter((r) => idDocSegment(r.id) === segment).map((r) => `${r.framework}\u0000${r.document_id}`),
  );
  const found = holdings.filter((h) => docIds.has(`${h.framework}\u0000${h.document_id}`));
  const pool = found.length > 0 ? found : holdings.filter((h) => h.document_id === segment);
  return [...pool].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/**
 * What a "No record for <id>" miss should add about WHY the record may be
 * absent. Four cases, because they need four different next steps:
 *
 *   partial        - the corpus holds only part of the document; the provision
 *                    can exist in the law and simply not be here;
 *   undeclared     - the registry never said, so absence proves nothing either
 *                    way (and "full" must not be assumed);
 *   declared full  - the document is held whole, so the id is probably mistyped;
 *   not held       - no document answers to the id's prefix.
 */
export function missingRecordClause(
  regulations: Regulation[],
  holdings: DocumentHolding[],
  id: RegulationId | string,
): string {
  const h = holdingForId(regulations, holdings, id);
  if (h === null) {
    return (
      `No document with the id prefix "${idDocSegment(id)}" is loaded; ` +
      "get_corpus_info lists the documents this corpus holds."
    );
  }
  if (h.partial === true) return partialClause(h);
  if (h.partial === undefined) {
    return (
      `This corpus holds ${recordsOf(h.records)} of ${nameOf(h)} and does not declare that as the ` +
      "whole, so absence here does not show the provision does not exist."
    );
  }
  return (
    `This corpus declares ${nameOf(h)} held in full (${recordsOf(h.records)}), so the id is ` +
    "probably mistyped."
  );
}

/** One line for the linter and scripts: `id records (partial|full|undeclared)`. */
export function holdingsSummary(holdings: DocumentHolding[]): string {
  return holdings
    .map((h) => `${h.document_id} ${h.records} (${h.partial === true ? "partial" : h.partial === false ? "full" : "undeclared"})`)
    .join(", ");
}

/**
 * Registry declarations that describe nothing: a source declaring `coverage`
 * for a document the corpus holds no regulation records of. Advisory - the
 * source may be registered ahead of its content - but a declaration about
 * records that are not there is a claim nobody can check.
 */
export function holdingsWarnings(regulations: Regulation[], sources: Source[]): string[] {
  const held = new Set(regulations.map((r) => `${r.framework}\u0000${r.document_id}`));
  return sources
    .filter((s) => s.coverage !== undefined && !held.has(`${s.framework}\u0000${s.document_id}`))
    .map((s) => `${s.id}: declares coverage "${s.coverage}" but the corpus holds no regulation records of ${s.document_id}`);
}
