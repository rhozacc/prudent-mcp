import { describe, expect, it } from "bun:test";

import { createServer } from "../src/server.ts";

describe("server registration", () => {
  it("constructs without crashing", () => {
    const server = createServer();
    expect(server).toBeDefined();
  });
});
