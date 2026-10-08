import { describe, expect, it } from "bun:test";

import {
  RESPONSE_CHAR_BUDGET,
  paginate,
  serialize,
} from "../src/tools/shared.ts";

// Page size and payload size are different quantities, and conflating them is
// what let one call return ~58,000 tokens of "20 results".

describe("paginate — the response size ceiling", () => {
  const row = (i: number): { id: number; text: string } => ({ id: i, text: "x".repeat(1_000) });
  const rows = Array.from({ length: 40 }, (_, i) => row(i));

  it("pages normally when the rows fit", () => {
    const env = paginate(rows, 5, 0);
    expect(env.returned).toBe(5);
    expect(env.total_matches).toBe(40);
    expect(env.next_offset).toBe(5);
    expect(env.notice).toContain("offset: 5");
  });

  it("shortens an oversized page and keeps total_matches true", () => {
    const env = paginate(rows, 40, 0, 5_000);
    expect(env.returned).toBeLessThan(40);
    expect(serialize(env.results).length).toBeLessThanOrEqual(5_000);
    // The count of the match set does not move because the page shrank — that
    // conflation is exactly the defect this replaced.
    expect(env.total_matches).toBe(40);
    expect(env.next_offset).toBe(env.returned);
    expect(env.notice).toContain("shortened");
  });

  it("never returns an empty page for a query that matched", () => {
    // An empty page reads as "no matches", which is a different answer. One
    // oversized row is served with the notice instead.
    const huge = [{ id: 0, text: "y".repeat(80_000) }];
    const env = paginate(huge, 20, 0, 1_000);
    expect(env.returned).toBe(1);
    expect(env.total_matches).toBe(1);
    expect(env.truncated).toBe(false);
    expect(env.next_offset).toBeNull();
  });

  it("reports the last page as untruncated", () => {
    const env = paginate(rows, 40, 39);
    expect(env.returned).toBe(1);
    expect(env.truncated).toBe(false);
    expect(env.next_offset).toBeNull();
    expect(env.notice).toBeUndefined();
  });

  it("defaults to the shared budget", () => {
    const many = Array.from({ length: 200 }, (_, i) => row(i));
    const env = paginate(many, 200, 0);
    expect(serialize(env.results).length).toBeLessThanOrEqual(RESPONSE_CHAR_BUDGET);
  });
});

describe("serialize — one encoding for the wire and the budget", () => {
  it("is compact, so a budget measured against it matches what is sent", () => {
    const value = { a: [1, 2, 3], b: { c: "d" } };
    expect(serialize(value)).toBe(JSON.stringify(value));
    expect(serialize(value)).not.toContain("\n");
    // Indentation cost 30-45% of a nested payload for nothing a model reads,
    // and it made a page shortened to 24,000 chars arrive as 35,338.
    expect(serialize(value).length).toBeLessThan(JSON.stringify(value, null, 2).length);
  });
});
