import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getDevServerCommand } from "./template-runtime-e2e.ts";

describe("template runtime E2E commands", () => {
  it("passes the selected port through Deno task without a separator", () => {
    assertEquals(getDevServerCommand("deno", 4321), {
      command: "deno",
      args: ["task", "dev", "--port", "4321"],
    });
  });

  it("preserves the script argument separator for npm and Bun", () => {
    assertEquals(getDevServerCommand("node", 4321), {
      command: "npm",
      args: ["run", "dev", "--", "--port", "4321"],
    });
    assertEquals(getDevServerCommand("bun", 4321), {
      command: "bun",
      args: ["run", "dev", "--", "--port", "4321"],
    });
  });
});
