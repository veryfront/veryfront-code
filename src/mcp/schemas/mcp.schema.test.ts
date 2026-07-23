import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getMCPServerConfigSchema, getMCPStatsSchema } from "./mcp.schema.ts";

describe("mcp/schemas/server-config", () => {
  const schema = getMCPServerConfigSchema();

  it("requires an executable bearer-token validator", () => {
    assertEquals(
      schema.safeParse({
        enabled: true,
        auth: { type: "bearer", validate: async () => true },
      }).success,
      true,
    );
    assertEquals(
      schema.safeParse({ enabled: true, auth: { type: "bearer" } }).success,
      false,
    );
  });

  it("accepts only valid TCP ports", () => {
    for (const port of [1, 65_535]) {
      assertEquals(
        schema.safeParse({
          enabled: true,
          port,
          auth: { type: "none", allowUnauthenticated: true },
        }).success,
        true,
      );
    }
    for (const port of [0, 65_536, 1.5, Number.NaN]) {
      assertEquals(
        schema.safeParse({
          enabled: true,
          port,
          auth: { type: "none", allowUnauthenticated: true },
        }).success,
        false,
      );
    }
  });

  it("accepts only canonical HTTP origins without credentials or paths", () => {
    assertEquals(
      schema.safeParse({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
        cors: {
          enabled: true,
          origins: ["http://localhost:3000", "https://example.com"],
        },
      }).success,
      true,
    );

    for (
      const origin of [
        "ftp://localhost",
        "https://user:password@example.com",
        "https://example.com/path",
        "not-an-origin",
      ]
    ) {
      assertEquals(
        schema.safeParse({
          enabled: true,
          auth: { type: "none", allowUnauthenticated: true },
          cors: { enabled: true, origins: [origin] },
        }).success,
        false,
      );
    }
  });

  it("rejects duplicate origins and unknown configuration keys", () => {
    assertEquals(
      schema.safeParse({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
        cors: {
          enabled: true,
          origins: ["https://example.com", "https://example.com"],
        },
      }).success,
      false,
    );
    assertEquals(
      schema.safeParse({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true, fallback: true },
      }).success,
      false,
    );
    assertEquals(
      schema.safeParse({
        enabled: true,
        auth: { type: "none", allowUnauthenticated: true },
        fallbackPort: 3001,
      }).success,
      false,
    );
  });
});

describe("mcp/schemas/stats", () => {
  const schema = getMCPStatsSchema();

  it("rejects contradictory totals and unknown fields", () => {
    assertEquals(
      schema.safeParse({ tools: 1, resources: 2, prompts: 3, total: 6 }).success,
      true,
    );
    assertEquals(
      schema.safeParse({ tools: 1, resources: 2, prompts: 3, total: 5 }).success,
      false,
    );
    assertEquals(
      schema.safeParse({
        tools: 1,
        resources: 2,
        prompts: 3,
        total: 6,
        stale: 1,
      }).success,
      false,
    );
  });
});
