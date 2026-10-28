import { describe, expect, it } from "bun:test";

import { DEMO_PLAYBOOKS, demoPlaybookContext } from "../examples/inmemory-demo.ts";
import { renderPlaybook } from "../src/render.ts";
import type { Applicability, Playbook } from "../src/schema.ts";
import { bannedTermsIn, identifiersIn } from "../src/language.ts";

// A playbook about text that no longer applies, or does not apply yet, opens with a one-line banner in domain language.
// Everything is rendered from the synthetic demo playbook with a declaration added.

const demo = Object.values(DEMO_PLAYBOOKS)[0]!;
const withApp = (applicability: Applicability): Playbook => ({ ...demo, applicability });
const ctx = demoPlaybookContext();
const TODAY = "2026-08-26";
const HIST: Applicability = { status: "historical", until: "2024-12-31", reason: "The approach was abolished", replaced_by: ["regulation://crr/180/1/a"] };

describe("playbook banner", () => {
  it("is absent for a playbook that declares nothing: the render is the one it always was", () => {
    const text = renderPlaybook(demo, ctx, { today: TODAY })!.text;
    expect(text.startsWith(`# ${demo.title}`)).toBe(true);
    expect(text).not.toContain("no longer");
  });

  it("opens a historical playbook with one quoted line: since when, why, and what replaced it by citation", () => {
    const text = renderPlaybook(withApp(HIST), ctx, { today: TODAY })!.text;
    const [first, blank, title] = text.split("\n");
    expect(first!.startsWith("> ")).toBe(true);
    expect(first).toContain("no longer apply");
    expect(first).toContain("after 2024-12-31");
    expect(first).toContain("The approach was abolished.");
    expect(first).toContain("replaced by Art. 180(1)(a) CRR");
    expect(blank).toBe("");
    expect(title).toBe(`# ${demo.title}`);
    expect(text).not.toContain("regulation://");
  });

  it("says an upcoming playbook is not yet in application, with the date or that none is fixed", () => {
    expect(renderPlaybook(withApp({ status: "upcoming", from: "2099-01-01", reason: "Postponed." }), ctx, { today: TODAY })!.text.split("\n")[0]).toContain("not yet in application: they apply from 2099-01-01");
    expect(renderPlaybook(withApp({ status: "upcoming", reason: "Postponed." }), ctx, { today: TODAY })!.text.split("\n")[0]).toContain("not yet fixed");
  });

  it("does not say text that still applies has stopped applying", () => {
    const first = renderPlaybook(withApp({ ...HIST, until: "2999-01-01" } as Applicability), ctx, { today: TODAY })!.text.split("\n")[0]!;
    expect(first).not.toContain("no longer");
    expect(first).toContain("ceasing to apply after 2999-01-01");
  });

  it("heads a single requirement too, so no part of it reads without the banner", () => {
    const text = renderPlaybook(withApp(HIST), ctx, { section: "R1", today: TODAY })!.text;
    expect(text.split("\n")[0]).toContain("no longer apply");
    expect(text).toContain("# R1.");
  });

  it("is domain words", () => {
    for (const a of [HIST, { status: "upcoming", reason: "Postponed." } as Applicability]) {
      const line = renderPlaybook(withApp(a), ctx, { today: TODAY })!.text.split("\n")[0]!;
      expect(bannedTermsIn(line)).toEqual([]);
      expect(identifiersIn(line)).toEqual([]);
    }
  });
});
