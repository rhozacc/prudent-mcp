/**
 * Content identity of a corpus file: the function the factory writes as
 * `corpus_sha256` and the benchmark checks a corpus against, so a file can be
 * proven to be the release it claims to be. Corpus-free logic: it reads no field
 * but `corpus_info.last_updated`.
 *
 * The digest is over the canonical JSON (keys sorted recursively, two-space
 * indent, trailing newline) with `corpus_info.last_updated` blanked: two builds
 * of identical content differ only in that timestamp, and an identity that moved
 * on every rebuild would identify nothing. Change nothing here without changing
 * the factory's writer in step; the pinned value in tests/digest.test.ts is the
 * contract.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) out[key] = sortKeysDeep(src[key]);
    return out;
  }
  return value;
}

/** Deterministic stringify: keys sorted recursively, 2-space indent, trailing newline. */
export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(sortKeysDeep(value), null, 2)}\n`;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function contentDigest(corpus: unknown): string {
  if (corpus === null || typeof corpus !== "object") throw new Error("corpus must be a JSON object");
  const obj = corpus as Record<string, unknown>;
  const info = obj["corpus_info"];
  const normalised =
    info !== null && typeof info === "object"
      ? { ...obj, corpus_info: { ...(info as Record<string, unknown>), last_updated: "" } }
      : obj;
  return sha256(canonicalJson(normalised));
}

export function corpusFileDigest(path: string): string {
  return contentDigest(JSON.parse(readFileSync(path, "utf8")) as unknown);
}
