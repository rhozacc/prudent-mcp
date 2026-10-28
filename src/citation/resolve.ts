// `resolveCitationDetailed`: the ordered passes that turn a citation into a record, a decline or candidates.
import { accountedFor, documentAliases, scopeToDocument, withInstrumentNames } from "./aliases.ts";
import type { AliasIndex } from "./aliases.ts";
import { SUBORDINATING_CUE, describedInstruments, holdsKind } from "./described.ts";
import { EMPOWERMENTS, corpusHolds, heldInstrumentDocuments, instrumentMentions, instrumentSpans } from "./instruments.ts";
import type { NamedInstrument } from "./instruments.ts";
import { unplacedIdentifier, unrecognisedNameTail } from "./names.ts";
import { textCarriesPoint } from "./points.ts";
import { STRUCTURAL, arraysEqual, citationTokens, recordTokensOf, spineIsFaithful, spineOf, startsWithTokens, windowAt, withoutConnectives } from "./tokens.ts";
import type { Regulation, DocumentHolding, CitationCandidate, CitationResolution } from "../schema.ts";
import { citationPartialClause } from "../holdings.ts";
import { quoted } from "../language.ts";

/** How many candidates a declined resolution is allowed to carry. */
const MAX_CANDIDATES = 10;

const asCandidate = (r: Regulation): CitationCandidate => ({
  id: r.id,
  citation: r.citation,
  document_id: r.document_id,
});

/**
 * Instrument key rendered the way a reader would write it.
 *
 * The era decides the "No": post-2015 acts are cited "Regulation (EU) 2021/930"
 * and writing "Regulation (EU) No 2021/930" is a wrong citation of a real act —
 * not a thing to emit from a refusal whose whole purpose is not guessing. The same
 * goes for the institution: an act the caller wrote as "(EC)" is quoted back as
 * "(EC)", never relabelled "(EU)"; one written with none is given "(EU)" only
 * where the era makes that the only possible tag, and none before it. Only
 * regulations were numbered serial/YEAR; a directive, decision or guideline is
 * YEAR/serial in every era.
 */
const instrumentLabel = (instrument: string, tag?: string): string => {
  const m = /^(regulation|directive|decision|guideline)-(\d{2,4})-(\d+)$/.exec(instrument);
  if (m === null) return instrument.toUpperCase();
  const kind = `${(m[1] ?? "").charAt(0).toUpperCase()}${(m[1] ?? "").slice(1)}`;
  const year = m[2] ?? "";
  const serial = m[3] ?? "";
  const modern = Number(year) >= 2015;
  const institution = tag ?? (modern ? "EU" : undefined);
  if (modern) return `${kind} (${institution}) ${year}/${serial}`;
  if (m[1] === "regulation") return `${kind}${institution === undefined ? "" : ` (${institution})`} No ${serial}/${year}`;
  return `${kind} ${year}/${serial}${institution === undefined ? "" : `/${institution}`}`;
};

/** Several equally good matches: report them all, choose none. */
function ambiguousResolution(text: string, hits: Regulation[]): CitationResolution {
  const docs = new Set(hits.map((r) => r.document_id));
  return {
    match: null,
    confidence: "none",
    ambiguous: true,
    candidates: hits.slice(0, MAX_CANDIDATES).map(asCandidate),
    unmatched_segments: [],
    coverage_note:
      `"${text}" matches ${hits.length} provisions across ${docs.size} document(s)` +
      `${hits.length > MAX_CANDIDATES ? ` (first ${MAX_CANDIDATES} listed)` : ""}. ` +
      "Name the document to disambiguate, or open one of the candidates.",
  };
}

/**
 * The citation with an issuer's descriptor removed, when the descriptor only describes a document the citation also names:
 * an ECB-kind descriptor, neither numbered nor an identifier, beside held documents of that one issuer, and no held
 * instrument named. Null in every other case, which is resolved as written (the gate below declines what it must).
 */
function withoutLooseIssuerDescriptor(regulations: Regulation[], text: string, holdings?: DocumentHolding[]): string | null {
  const index = documentAliases(regulations, holdings);
  const described = describedInstruments(text, [...index.values()].map((e) => e.tokens));
  const unheld = described.found.filter((d) => !holdsKind(regulations, d.held));
  if (unheld.length === 0) return null;
  if (!unheld.every((d) => d.issuer !== undefined && !d.identifier && !d.numbered)) return null;
  const residualTokens = citationTokens(described.residual);
  if (spineOf(residualTokens.filter((t) => !STRUCTURAL.has(t))).length === 0) return null;
  if (instrumentSpans(text).some((n) => corpusHolds(regulations, n.key))) return null;
  const namedDocs = scopeToDocument(residualTokens, index).docs;
  if (namedDocs === null) return null;
  const frameworks = new Set(regulations.filter((r) => namedDocs.has(r.document_id)).map((r) => r.framework.toLowerCase()));
  if (frameworks.size !== 1 || !unheld.every((d) => frameworks.has(d.issuer ?? ""))) return null;
  return described.residual;
}

/**
 * Loose citation string to a resolution that can say "I don't know".
 *
 * The previous version could not. It matched normalized citations by
 * containment in either direction, so "Article 1218" contained "Article 121"
 * and resolved to it; and it fell back to a suffix match on id segments. With
 * no check on the instrument a citation named, "Article 178 of the CRR" landed
 * on whatever document happened to have a paragraph 178. Every one of those
 * came back as a confident, fully-populated match with no way to tell it from
 * a real hit — which for a regulatory tool is the worst failure available,
 * because the consumer presents it to a reader as a citation.
 *
 * Matching now, in order, and nothing below it:
 *
 *   (i) exact normalized-citation equality, then equality against a record's
 *       declared aliases. First, because a record's own citation is the
 *       strongest evidence there is and no gate may refuse it;
 *   (0) instrument gate — a citation naming an instrument the corpus does not
 *       hold resolves to null with a coverage note, never into another
 *       document that shares a number. Named by number, or by description
 *       ("the RTS on …", "an ECB Guideline") when no held document is that kind;
 *   (ii) exact equality of the numeric SPINE (article/paragraph/point numbers,
 *        structural words dropped), scoped to the document the citation names.
 *        Exact: 1218 is not 121, and 178 is not 178(1)(a);
 *   (iii) narrower relatives — records whose spine strictly extends the
 *        citation's. Returned as candidates with match still null, because
 *        "the corpus holds 178(1)(a) and 178(1)(b) but no Article 178" is
 *        useful and "Article 178 is 178(1)(a)" is false.
 *
 * Several equally good matches make the result ambiguous — candidates are
 * returned and `match` stays null, because picking one silently is the bug.
 */
export function resolveCitationDetailed(
  regulations: Regulation[],
  text: string,
  // Optional so every existing caller keeps its behaviour: without holdings the
  // notes below are exactly what they were. With them, a decline on a partly
  // held document says the absence is the corpus's and not necessarily the law's.
  holdings?: DocumentHolding[],
): CitationResolution {
  const none = (extra: Partial<CitationResolution> = {}): CitationResolution => ({
    match: null,
    confidence: "none",
    candidates: [],
    ambiguous: false,
    unmatched_segments: [],
    ...extra,
  });

  const queryTokens = citationTokens(text);
  const recordTokens = recordTokensOf(regulations);
  if (queryTokens.length === 0) return none();

  // An ECB-kind descriptor ("ECB Guidelines") beside a held document of that issuer is a loose second name for the
  // document, and the equality passes below compare the WHOLE citation: with the descriptor left in, an alias or a
  // record's own citation never equals it. So it is set aside before anything is compared, not after.
  const withoutDescriptor = withoutLooseIssuerDescriptor(regulations, text, holdings);
  if (withoutDescriptor !== null) return resolveCitationDetailed(regulations, withoutDescriptor, holdings);

  // The document a citation names is stripped from BOTH sides before anything
  // is compared: a record's own citation may repeat it ("CRR Article 180"), a
  // query may omit it ("Art. 180"), and its numbers ("2017/16") are not the
  // provision's.
  //
  // The names are the ids the records carry, the registry's titles, and the
  // instruments the citation mentions (the "Capital Requirements Regulation",
  // "Regulation (EU) No 575/2013"). The last two are DERIVED: they win over an id by
  // being longer, so they only scope a citation that is accounted for - exactly a
  // record's own citation once the name is gone, or nothing left in it that could
  // name another document (`accountedFor`). Otherwise the ids alone decide, as
  // they did before titles and instrument names were names.
  // An instrument named as context for a held one ("... of the CRR, as amended by
  // Regulation (EU) 2024/1623") is not a second claim about where the provision is.
  const spans = instrumentSpans(text);
  const subordinate = (n: { start: number }): boolean =>
    SUBORDINATING_CUE.test(text.slice(0, n.start)) && spans.some((o) => o.start < n.start && corpusHolds(regulations, o.key));
  const attempt = (index: AliasIndex) => {
    const scope = scopeToDocument(queryTokens, index);
    const pool = scope.docs === null ? regulations : regulations.filter((r) => scope.docs?.has(r.document_id) === true);
    const bare = (tokens: string[]): string[] => scopeToDocument(tokens, index).rest;
    // (i) Exact equality of the whole citation, structural words included — so
    // "paragraph 78" does not match a record that says "Article 78".
    // Joined with a SEPARATOR, not concatenated. "Article 4(1)" and "Article 41"
    // tokenise to ["article","4","1"] and ["article","41"]; run together they are
    // both "article41", so a bracketed point silently became a different article
    // number — and on this corpus that offered EBA "Paragraph 41" as the answer
    // to a question about Article 4(1). Matching only ever gets stricter here.
    const nq = scope.rest.join(" ");
    const exactHits = pool.filter((r) => bare(recordTokens(r.citation)).join(" ") === nq);
    // (i-alias) The same equality against a record's declared aliases. Looked for
    // here too, because a derived scope is accepted on either.
    const aliasHits =
      exactHits.length > 0
        ? []
        : pool.filter((r) => (r.citation_aliases ?? []).some((a) => bare(recordTokens(a)).join(" ") === nq));
    // (i-core) The same equality with the connectives left out of both sides, for a
    // citation that has some ("Article 3 of the") and found no exact record.
    const core = (tokens: string[]): string => withoutConnectives(bare(tokens)).join(" ");
    const nqCore = withoutConnectives(scope.rest).join(" ");
    const coreHits =
      exactHits.length > 0 || aliasHits.length > 0 || nqCore === nq
        ? []
        : pool.filter((r) => core(recordTokens(r.citation)) === nqCore);
    // The same, against a record's declared aliases: "Credit risk chapter, paragraph 170 of the (EGIM)" is the alias
    // once the connectives are set aside, exactly as "Article 3 of the" is a record's own citation.
    const coreAliasHits =
      exactHits.length > 0 || aliasHits.length > 0 || coreHits.length > 0 || nqCore === nq
        ? []
        : pool.filter((r) => (r.citation_aliases ?? []).some((al) => core(recordTokens(al)) === nqCore));
    return { index, ...scope, pool, bare, nq, exactHits, aliasHits, coreHits, coreAliasHits };
  };
  let scoped = attempt(withInstrumentNames(documentAliases(regulations, holdings), regulations, text));
  if (
    scoped.derived &&
    scoped.docs !== null &&
    scoped.exactHits.length === 0 &&
    scoped.aliasHits.length === 0 &&
    scoped.coreHits.length === 0 &&
    scoped.coreAliasHits.length === 0 &&
    !accountedFor(text, scoped.rest, scoped.docs, scoped.index, (n) => !corpusHolds(regulations, n.key) && subordinate(n))
  ) {
    scoped = attempt(documentAliases(regulations));
  }
  const { index, docs, rest, pool, bare, exactHits, aliasHits, coreHits, coreAliasHits } = scoped;

  if (exactHits.length === 1) {
    return { ...none(), match: exactHits[0] ?? null, confidence: "exact" };
  }
  if (exactHits.length > 1) return ambiguousResolution(text, exactHits);

  // (i-alias) The same equality against a record's declared aliases.
  //
  // Kept as its own pass, and its own confidence level, rather than folded into
  // (i): the caller asked for a label this record does not carry. EBA
  // guidelines number PARAGRAPHS, so "Article 178" is a common way to cite one
  // and also a real CRR article — the alias makes the loose spelling resolvable
  // without letting it be reported as the record's citation.
  if (aliasHits.length === 1) {
    const hit = aliasHits[0];
    return {
      ...none(),
      match: hit ?? null,
      confidence: "alias",
      coverage_note:
        hit === undefined
          ? undefined
          : `Matched an alias. This provision's own citation is ${quoted(hit.citation)} — quote that, ` +
            `not "${text}".`,
    };
  }
  if (aliasHits.length > 1) return ambiguousResolution(text, aliasHits);

  // (i-core) A citation that is a record's own once the connectives are set aside.
  // Before this, a citation the document's name had left a dangling "of the" on was
  // compared by its numbers alone, where a record with the same number and a
  // different kind of citation (a section whose label reduces to "3") tied with the
  // article that was asked for. Kind words and numbers are all equal here, so the
  // tie is broken by the record that says what was asked, and the confidence stays
  // "segment": it is the spine pass's answer, made unambiguous.
  if (coreHits.length === 1) return { ...none(), match: coreHits[0] ?? null, confidence: "segment" };
  if (coreHits.length > 1) return ambiguousResolution(text, coreHits);
  if (coreAliasHits.length === 1) {
    const hit = coreAliasHits[0];
    return {
      ...none(),
      match: hit ?? null,
      confidence: "alias",
      coverage_note: hit === undefined ? undefined : `Matched an alias. This provision's own citation is ${quoted(hit.citation)} — quote that, not "${text}".`,
    };
  }
  if (coreAliasHits.length > 1) return ambiguousResolution(text, coreAliasHits);

  // (0) The instrument gate. A wrong instrument is not a near miss, it is a
  // different body of law - but it comes AFTER the two equality passes above. A
  // record's own citation (or a label it declares) is the strongest evidence a
  // citation can have, and a gate that reads words inside it ("RTS Article 5",
  // "Regulation (EU) 2022/439, Article 14") as a second instrument would refuse
  // the very record the caller quoted.
  //
  // Judged by the first named instrument the corpus does not hold. A held
  // instrument named beside an unheld act does not vouch for it, with two
  // exceptions that are not claims about the act at all. A mention inside the longer
  // name of a document that WAS recognised (a guideline's title quotes the
  // regulation it is issued under) is part of that name. And an act that follows a
  // subordinating phrase after a held instrument ("... of the CRR, as amended by
  // Regulation (EU) 2024/1623") is context for the held instrument, which stays the
  // home of the provision: refusing the citation for the amending act would be the
  // one refusal that is untrue of what was asked.
  const insideName = (n: NamedInstrument): boolean => docs !== null && windowAt(rest, citationTokens(n.span)) === -1;
  const unheldMention = spans.find((n) => !corpusHolds(regulations, n.key) && !insideName(n) && !subordinate(n));
  if (unheldMention !== undefined) {
    const gated = unheldMention.key;
    // A dead end that names the way out. Two ways out, in fact, and which one
    // is available decides whether the caller goes looking or guesses.
    //
    // (a) What the instrument IS. A refusal that says only "not held" invites
    //     the model to supply the instrument's identity from memory, and the
    //     identity — its tier, and the provision empowering it — is the part it
    //     gets wrong. Curated, checkable against a provision this corpus serves.
    // (b) Which served records NAME it. Scanned from the text rather than read
    //     off `cites[].framework`, which holds only `crr`/`crd` and so could
    //     never fire for a numbered act.
    const what = EMPOWERMENTS[gated];
    // Both sources, unioned. `cites[].framework` is the only one that reaches a
    // named framework like `crr`; the text scan is the only one that reaches a
    // numbered act. Each is blind where the other sees.
    const byCite = regulations
      .filter((r) => (r.cites ?? []).some((c) => citationTokens(c.framework).join("") === gated))
      .map((r) => r.id);
    const mentions = [
      ...new Set([...byCite, ...(instrumentMentions(regulations).get(gated) ?? [])]),
    ];
    const shown = mentions.slice(0, 3);
    return none({
      coverage_note:
        `This library holds no ${instrumentLabel(gated, unheldMention.tag)}. Nothing was matched, rather than ` +
        "sourcing a same-numbered provision from another document. " +
        (what === undefined
          ? ""
          : `It is ${what.kind}` +
            (what.empoweredBy === undefined ? "" : `, adopted under ${what.empoweredBy}`) +
            ". " +
            (what.visibleAt === undefined
              ? ""
              : `That relationship is stated in the text at ${what.visibleAt}. `)) +
        (shown.length > 0
          ? `${mentions.length} held provision(s) name it: ${shown.join(", ")}` +
            `${mentions.length > shown.length ? ", …" : ""} — open those for what this library ` +
            "says about it. Its own text is not here, so do not state its requirements from this library."
          : "The library's overview lists the documents it holds."),
    });
  }

  // The held instrument the citation names, if any: for the descriptive gate, which
  // has to say when a citation names a held instrument AND a described one.
  const heldMention = spans.find((n) => corpusHolds(regulations, n.key));
  const instrument = heldMention?.key ?? null;
  const instrumentName = heldMention === undefined ? null : instrumentLabel(heldMention.key, heldMention.tag);

  // (0b) The descriptive gate. The same defence for an instrument named by what
  // it IS rather than by number: "Article 49(3) of the RTS on the IRB assessment
  // methodology" carries no number the gate above can read, so the instrument was
  // dropped and the bare "49(3)" went looking — and was offered paragraph 49 of
  // two unrelated guidelines as the containing provision. A decline is cheap; a
  // citation into the wrong body of law is the worst thing this server produces.
  //
  // Fires only for a description the corpus has no document identifying as, so a
  // corpus that does hold an RTS falls through to normal resolution. When the
  // citation ALSO names a held document, which of the two the "Article 49(3)"
  // belongs to is not something this resolver can know: decline, naming both.
  //
  // One exception, and it is not a second instrument at all: an ECB-kind descriptor
  // ("ECB Guidelines", "ECB Regulation") beside a held document whose framework is
  // that same issuer. "ECB Guidelines (EGIM) Chapter 3, paragraph 181" calls the one
  // document twice, once by what the ECB calls such texts and once by its id, and
  // the id is the exact half. The descriptor is then a loose description of the
  // document named and resolution goes on as if it were absent. Not when the
  // descriptor is numbered or an identifier (that is one specific act), not when
  // another instrument is named, and not when the document named is of another issuer.
  const described = describedInstruments(text, [...index.values()].map((e) => e.tokens));
  const unheld = described.found.filter((d) => !holdsKind(regulations, d.held));
  // Only when there is a provision number to place. Without one nothing can be
  // sourced from a same-numbered provision, and the "no provision number" note
  // below already says the instrument may be described without being held.
  const placeable =
    spineOf(citationTokens(described.residual).filter((t) => !STRUCTURAL.has(t))).length > 0;
  const namedDocs = unheld.length > 0 && placeable ? scopeToDocument(citationTokens(described.residual), index).docs : null;
  const looselyDescribed = ((): boolean => {
    if (namedDocs === null || docs === null || instrumentName !== null) return false;
    if (!unheld.every((d) => d.issuer !== undefined && !d.identifier && !d.numbered)) return false;
    const frameworks = new Set(regulations.filter((r) => namedDocs.has(r.document_id)).map((r) => r.framework.toLowerCase()));
    return frameworks.size === 1 && unheld.every((d) => frameworks.has(d.issuer ?? ""));
  })();
  if (unheld.length > 0 && placeable && !looselyDescribed) {
    const mentioned = unheld.map((d) => `"${d.quote}"`).join(" and ");
    const identifiers = unheld.every((d) => d.identifier);
    const heldNames: string[] = [];
    if (instrumentName !== null) heldNames.push(instrumentName);
    // `crr` the instrument and `crr` the document are one thing named twice.
    const instrumentDocs = instrument === null ? new Set<string>() : heldInstrumentDocuments(regulations, instrument);
    for (const d of namedDocs ?? []) {
      if (instrumentDocs.has(d)) continue;
      if (!heldNames.some((n) => n.toLowerCase() === d.toLowerCase())) heldNames.push(d);
    }
    // An alias naming several documents is a framework ("EBA"), not a document:
    // listing its members would say the citation named each of them.
    const group = instrument === null && (namedDocs?.size ?? 0) > 1;
    const heldList = group
      ? `documents under a framework or name it shares (${heldNames.slice(0, 3).join(", ")}${heldNames.length > 3 ? ", …" : ""})`
      : `a document this library holds (${heldNames.slice(0, 3).join(", ")})`;
    // A number the number gate cannot read is not a reason to say "cite it by
    // number": the caller did, and the form is what was missing.
    const numberedDescription = !identifiers && unheld.some((d) => d.numbered);
    const wayOut =
      (identifiers
        ? ""
        : numberedDescription
          ? "Cite the instrument in full, kind then \"(EU)\" then its number (for example " +
            "\"Regulation (EU) YYYY/NNN\"), so this library can say whether it is held; "
          : "Cite the instrument by number so this library can say whether it is held; ") +
      (identifiers ? "Search" : "search") +
      " for its name to see what the provisions held here say about it, or check the library's overview for " +
      "what it holds. This note states nothing about what it requires.";
    const how = identifiers ? "an identifier" : "description";
    // A description by an issuer's kind ("ECB Guidelines") does not mean the corpus
    // holds nothing from that issuer, and "no document identified as such" must not
    // read as if it did. Listed, never matched: which of them was meant is for the
    // caller to say.
    const issuers = [...new Set(unheld.flatMap((d) => (d.issuer === undefined || d.identifier || d.numbered ? [] : [d.issuer])))];
    const sameIssuer = [...new Set(regulations.filter((r) => issuers.includes(r.framework.toLowerCase())).map((r) => r.document_id))];
    const issuerNote =
      sameIssuer.length === 0
        ? ""
        : ` It does hold ${sameIssuer.length === 1 ? "a document" : "documents"} under the ${issuers.map((i) => i.toUpperCase()).join("/")} ` +
          `framework (${sameIssuer.slice(0, 5).join(", ")}${sameIssuer.length > 5 ? ", …" : ""}); ` +
          "if one of those is what was meant, cite it by its id or title.";
    return none({
      coverage_note:
        heldNames.length === 0
          ? identifiers
            ? `"${text}" names an instrument by an identifier (${mentioned}), and this library holds no ` +
              "document identified as such. Nothing was matched, rather than sourcing a " +
              `same-numbered provision from another document. ${wayOut}`
            : `"${text}" names an instrument by description (${mentioned}), and this library holds no ` +
              "document identified as such. Nothing was matched, rather than sourcing a same-numbered " +
              `provision from another document.${issuerNote} ${wayOut}`
          : `"${text}" names ${heldList} ` +
            `and also an instrument by ${how} (${mentioned}) that it holds no document identified ` +
            "as, so which of the two the provision belongs to cannot be told. Nothing was matched, " +
            `rather than sourcing a same-numbered provision from either. Name one instrument per ` +
            `citation. ${wayOut}`,
    });
  }

  // (0c) A document's number that no held document answers to. "Article 49(3) of
  // EBA/GL/2018/04" names a document by its number; when the registry holds no
  // such document, the framework ("EBA") alone scoped the citation and the number
  // fell through into the provision's spine as points 2018 and 04 - which is how
  // an unheld guideline was answered with paragraph 49 of two held ones. A number
  // that a held document's name consumed is gone from `rest`; one still there was
  // not the number of anything held.
  const unplaced = unplacedIdentifier(text, rest);
  if (unplaced !== null) {
    return none({
      coverage_note:
        `"${text}" names a document by the number ${unplaced}, and this library holds no document that ` +
        "answers to it, so the number was not read as part of a provision's. Nothing was matched, " +
        "rather than sourcing a same-numbered provision from another document. The library's overview " +
        "lists the documents it holds; or search with the document's name.",
    });
  }

  // (0d) A document named in words nothing here answers to. Past "of", "in" or
  // "under", content words the registry does not recognise name a document the
  // citation is about; with no held document named, the bare provision number
  // would be looked for in every document at once, and a unique hit in one of them
  // is a guess dressed as a match ("Article 5 of Basel III" answered with paragraph
  // 5 of whichever guideline had one). Nothing is returned: a candidate would be
  // the same guess, listed. Not when the citation names a held instrument and its
  // scope was withheld (`accountedFor`): the words may be that instrument's own
  // title, and "does not recognise" would be untrue of it.
  const unrecognised = docs === null && heldMention === undefined ? unrecognisedNameTail(queryTokens) : null;
  if (unrecognised !== null) {
    const held = [...new Set(regulations.map((r) => r.document_id))];
    const partialNote = citationPartialClause(holdings, null);
    return none({
      coverage_note:
        `"${text}" is about something this library does not recognise as a document it holds ` +
        `("${unrecognised.join(" ")}"), so a provision with that number in a held document would be a ` +
        "guess. Nothing was matched. Name the document by an id or title from the library's overview" +
        `${held.length === 0 ? "" : ` (${held.slice(0, 6).join(", ")}${held.length > 6 ? ", …" : ""})`}, ` +
        "or drop the words that are not part of its name." +
        `${partialNote === null ? "" : ` ${partialNote}`}`,
    });
  }

  // (ii) Spine equality: the numbers alone, however the citation spells the
  // structure around them.
  const spine = spineOf(rest.filter((t) => !STRUCTURAL.has(t)));
  if (spine.length === 0) {
    // A citation with no provision number in it — a document name on its own
    // ("EBA/GL/2019/03"), or prose naming an instrument by description ("the
    // RTS on economic downturn"). There is nothing to place, but a bare null is
    // the worst answer available: it is strictly LESS information than an
    // instrument the corpus does not hold gets, and it reads as "unknown
    // string" at the exact moment the caller is deciding whether to look
    // elsewhere or fill in from memory.
    //
    // Say which of the two it is, because they need opposite next steps.
    const named = docs === null ? [] : [...docs];
    return none({
      coverage_note:
        named.length > 0
          ? `"${text}" names a document this library holds (${named.join(", ")}) but no provision ` +
            "within it. Add a provision number, or search inside it."
          : `"${text}" carries no provision number to resolve, and names no document this library ` +
            "holds. If it names an instrument, this library may still describe it without holding " +
            "it — search for its distinctive words, or check the library's overview for what it holds.",
    });
  }

  const recordSpine = (r: Regulation): string[] =>
    spineOf(bare(recordTokens(r.citation)).filter((t) => !STRUCTURAL.has(t)));

  const spineHits = pool.filter((r) => arraysEqual(recordSpine(r), spine));
  if (spineHits.length === 1) {
    return { ...none(), match: spineHits[0] ?? null, confidence: "segment" };
  }
  if (spineHits.length > 1) return ambiguousResolution(text, spineHits);

  // (iii) Narrower relatives. Reported, never returned as the match.
  // The partly-held clause rides on the two notes that say "this record is not
  // here" (iii and the final one). `match` and `confidence` are untouched: the
  // clause explains an absence, it never turns one into a hit. The container note
  // (iv) does not carry it - there the provision's text IS held, inside the
  // container, so nothing is missing to explain.
  const partial = citationPartialClause(holdings, docs);
  const withPartial = (note: string): string => (partial === null ? note : `${note} ${partial}`);

  const relatives = pool.filter((r) => startsWithTokens(recordSpine(r), spine));
  if (relatives.length > 0) {
    return none({
      candidates: relatives.slice(0, MAX_CANDIDATES).map(asCandidate),
      coverage_note: withPartial(
        `No provision is "${text}" itself. This library holds ${relatives.length} narrower provision(s) ` +
          `under it${relatives.length > MAX_CANDIDATES ? ` (first ${MAX_CANDIDATES} listed)` : ""}; ` +
          "open one, or walk its subtree.",
      ),
    });
  }

  // (iv) The CONTAINING provision — the mirror of (iii), and the half that was
  // missing. Rule (iii) answers "the corpus holds provisions under the one you
  // named"; this answers "the corpus holds the record yours sits inside".
  //
  // It matters because of how a corpus can be shaped rather than how citations
  // are written: a document may be stored at whole-article granularity, with no
  // record carrying a bracketed citation, while most of the cross-references the
  // corpus makes about itself are bracketed sub-article points. So "Article
  // 181(1)(b)" was a bare miss reading "nothing in this corpus is numbered
  // 181.1.b", for a provision served in full, whose text contains point (b)
  // verbatim.
  //
  // Still a decline: `match` stays null and `confidence` stays "none". Matching
  // is not being loosened — the container is reported as a candidate, exactly
  // as a narrower relative is. Token-level prefix, so 1218 still cannot claim
  // to contain 121.
  const containerTokens = rest.filter((t) => !STRUCTURAL.has(t));
  const containers = (spineIsFaithful(containerTokens) ? pool : [])
    .map((r) => ({ r, rs: recordSpine(r), rt: bare(recordTokens(r.citation)).filter((t) => !STRUCTURAL.has(t)) }))
    // Two guards, both against a SHORT spine claiming to contain a long one.
    // A record whose citation carries no numbers is a prefix of everything, so
    // a "Preamble" would contain every citation in the corpus. And a record
    // whose numbering the spine could not represent reduces to a fragment of
    // itself — "Section P3.TIV.C1b.S2b-3" becomes ["3"] and would offer itself
    // as the container of anything numbered 3.
    .filter(({ rs, rt }) => rs.length > 0 && spineIsFaithful(rt) && startsWithTokens(spine, rs))
    // Narrowest first: the most specific container is the most useful one.
    .sort((a, b) => b.rs.length - a.rs.length);
  if (containers.length > 0) {
    // Which document the container is in is part of the claim. Containers from
    // several documents are not alternatives for one provision, they are different
    // provisions that happen to share a number, and presenting the first of them
    // as "the provision containing it" - then reading ITS text for the point -
    // verifies the wrong document's text for a citation that may be about
    // another. So when the containers span documents there is no best one, and no
    // verdict on any text: the candidates are listed by document and the caller
    // is asked to name one.
    const holders = [...new Set(containers.map(({ r }) => r.document_id))];
    if (holders.length > 1) {
      // The narrowest container of each document, so every document is represented
      // however many nested records one of them holds.
      const perDocument = holders.map((d) => containers.find(({ r }) => r.document_id === d)!.r);
      const listed = perDocument.slice(0, MAX_CANDIDATES);
      const where =
        docs === null
          ? `sit in ${holders.length} documents (${holders.slice(0, 5).join(", ")}${holders.length > 5 ? ", …" : ""}) and the citation names none of them`
          : `sit in ${holders.length} of the documents it names (${holders.slice(0, 5).join(", ")}${holders.length > 5 ? ", …" : ""})`;
      return none({
        unmatched_segments: spine,
        candidates: listed.map(asCandidate),
        coverage_note:
          `No provision is "${text}" itself — this library does not address provisions at that granularity. ` +
          `Provisions that could contain it ${where}, so which one it belongs to cannot be told, and nothing ` +
          `is said here about whether the text of any of them has the point. ` +
          `${perDocument.length > listed.length ? `(First ${MAX_CANDIDATES} listed.) ` : ""}` +
          "Name the document, or open the candidates and check.",
      });
    }
    const best = containers[0]!;
    const points = spine.slice(best.rs.length);
    const inside = points.join(".");
    // The note used to say the text "carries" the point without looking. An
    // article of seven paragraphs does not carry point 9, and a caller told it
    // does goes looking and quotes around the gap. Only a verified `yes` keeps
    // that sentence.
    const carries = textCarriesPoint(best.r.text, points);
    const held = `It holds the provision containing it: ${quoted(best.r.citation)} (${best.r.id})`;
    const tail =
      carries === "yes"
        ? `, whose text carries point ${inside}. Open it and quote the point from its text rather than citing this resolution.`
        : carries === "no"
          ? `, but no point ${inside} was found in its text; its numbering may differ. Open it and ` +
            "check before anything is cited from this resolution."
          : `; whether its text has point ${inside} could not be established, as its numbering could not be read ` +
            "reliably. Open it.";
    return none({
      unmatched_segments: spine,
      candidates: containers.slice(0, MAX_CANDIDATES).map(({ r }) => asCandidate(r)),
      coverage_note:
        `No provision is "${text}" itself — this library does not address provisions at that ` +
        `granularity. ${held}${tail}`,
    });
  }

  // Nothing placed the citation. Say which parts went unmatched, so a dropped
  // point is visible rather than silently ignored.
  return none({
    unmatched_segments: spine,
    coverage_note:
      `Nothing in this library is numbered ${spine.join(".")}${docs === null ? "" : " in the document named"}. ` +
      (partial === null ? "" : `${partial} `) +
      "Try a search on the citation's key words.",
  });
}

/** Back-compatible shim: the match alone, or null. */
export function resolveCitationIn(regulations: Regulation[], text: string): Regulation | null {
  return resolveCitationDetailed(regulations, text).match;
}
