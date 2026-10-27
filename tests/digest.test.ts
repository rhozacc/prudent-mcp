import { describe, expect, test } from "bun:test";
import { canonicalJson, contentDigest } from "../src/digest.ts";

// A tiny synthetic fixture. The pinned digest was computed by the existing
// implementation in the benchmark repo (src/digest.ts) and agrees with the factory's
// writer, which hashes canonicalJson with `corpus_info.last_updated` blanked.
const corpus = {
  corpus_info: { last_updated: "2026-09-12T01:13:32.085Z", counts: { regulation: 1 } },
  regulation: [{ id: "regulation://a/b", text: "x" }],
};

describe("contentDigest", () => {
  test("ignores key order and the build timestamp, and nothing else", () => {
    const reordered = {
      regulation: [{ text: "x", id: "regulation://a/b" }],
      corpus_info: { counts: { regulation: 1 }, last_updated: "2030-01-01T00:00:00Z" },
    };
    expect(contentDigest(reordered)).toBe(contentDigest(corpus));
    expect(contentDigest({ ...corpus, regulation: [{ id: "regulation://a/b", text: "y" }] })).not.toBe(contentDigest(corpus));
  });

  test("is stable (a pin for the canonical form)", () => {
    expect(contentDigest(corpus)).toBe("1e5f86456469e60e4e23e44a7b4b1672a20b0b3e75d6f6c1e485054ed5482086");
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(
      '{\n  "a": [\n    2,\n    {\n      "c": 2,\n      "d": 1\n    }\n  ],\n  "b": 1\n}\n',
    );
  });

  test("rejects a non-object", () => expect(() => contentDigest(42)).toThrow());
});
