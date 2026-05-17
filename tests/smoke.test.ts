import { describe, expect, it } from "bun:test";

import { createServer } from "../src/server.ts";
import { adapters } from "../src/adapters.ts";

describe("server registration", () => {
  it("constructs without crashing", () => {
    const server = createServer();
    expect(server).toBeDefined();
  });

  it("registers the expected surface area (12 tools, 4 resource templates, 3 prompts)", () => {
    const server = createServer();
    const s = server as unknown as {
      _registeredTools: Record<string, unknown>;
      _registeredResourceTemplates: Record<string, unknown>;
      _registeredPrompts: Record<string, unknown>;
    };
    expect(Object.keys(s._registeredTools).length).toBe(12);
    expect(Object.keys(s._registeredResourceTemplates).length).toBe(4);
    expect(Object.keys(s._registeredPrompts).length).toBe(3);
  });

  it("get_referrers on regulation://crr/180/1/a returns checks and playbooks that reference it", async () => {
    // Wire the in-memory adapters (side effects in the demo module do the assignment).
    await import("../examples/inmemory-demo.ts");
    const result = await adapters.meta.referrers("regulation://crr/180/1/a");
    expect(result.checks).toEqual(["check://lra-pd-derived"]);
    expect(result.playbooks).toEqual(["playbook://calibration/pd"]);
    expect(result.regulation).toEqual([]);
    expect(result.tests).toEqual([]);
  });
});
