import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { formatErrorBox, formatUserError } from "./error-formatter.ts";
import { CONFIG_NOT_FOUND } from "../error-registry.ts";
import { ERROR_OUTPUT_MAX_LENGTH_CHARS } from "../safe-diagnostics.ts";

describe("formatErrorBox", () => {
  it("should return a string containing the error message", () => {
    const result = formatErrorBox(new Error("Something went wrong"));
    assert(typeof result === "string");
    assert(result.includes("Something went wrong"));
  });

  it("should include 'Error' title", () => {
    const result = formatErrorBox(new Error("test error"));
    assert(result.includes("Error"));
  });

  it("should include solution steps for known errors", () => {
    const error = new Error("Config file not found in project");
    error.name = "ConfigNotFoundError";

    const result = formatErrorBox(error);
    assert(result.length > 0);
  });

  it("should include doctor hint for unknown errors", () => {
    const result = formatErrorBox(new Error("some random unknown error xyz_unique"));
    assert(result.includes("veryfront doctor"));
  });

  it("should include solution details for known client boundary errors", () => {
    const result = formatErrorBox(new Error("Client boundary violation in component"));

    assert(result.includes("Server-only code used in Client Component"));
    assert(result.includes("How to fix:"));
    assert(result.includes("Learn more:"));
    assert(result.includes("client-boundary-violation"));
  });

  it("should neutralize terminal and line injection in the error message", () => {
    const injection = "\x1b]2;owned\x07\x1b[2J\nFAKE SUCCESS";
    const result = formatErrorBox(new Error(`failure ${injection}`));

    for (const forbidden of ["\x1b]2;owned", "\x1b[2J", "\x07", "\nFAKE SUCCESS"]) {
      assertEquals(result.includes(forbidden), false);
    }
  });

  it("should use one message snapshot for the header and solution", () => {
    let messageReads = 0;
    const stateful = new Proxy(new Error("unused"), {
      get(target, property, receiver): unknown {
        if (property === "message") {
          messageReads++;
          return messageReads === 1 ? "Port is in use" : "Build failed";
        }
        return Reflect.get(target, property, receiver);
      },
    });

    const result = formatErrorBox(stateful);

    assert(result.includes("Port is in use"));
    assert(result.includes("Port is already in use"));
    assertEquals(result.includes("Build failed with errors"), false);
    assertEquals(messageReads, 1);
  });

  it("should bound box-width amplification from an oversized message", () => {
    const result = formatErrorBox(
      new Error("x".repeat(ERROR_OUTPUT_MAX_LENGTH_CHARS * 2)),
    );

    assert(result.length <= ERROR_OUTPUT_MAX_LENGTH_CHARS);
    assert(result.includes("...[truncated]"));
  });
});

describe("formatUserError", () => {
  it("should return a string containing the error message", () => {
    const result = formatUserError(new Error("Something went wrong"));
    assert(typeof result === "string");
    assert(result.includes("Something went wrong"));
  });

  it("should include Error prefix", () => {
    const result = formatUserError(new Error("test error"));
    assert(result.includes("Error"));
  });

  it("should include stack trace for unknown errors", () => {
    const result = formatUserError(new Error("unknown error xyz_unique_test"));
    assert(result.includes("Stack trace") || result.includes("veryfront doctor"));
  });

  it("should include doctor hint for unknown errors", () => {
    const result = formatUserError(new Error("completely unknown error abcdef"));
    assert(result.includes("veryfront doctor"));
  });

  it("should include numbered solution steps for known config errors", () => {
    const result = formatUserError(new Error("veryfront.config.ts not found"));

    assert(result.includes("How to fix:"));
    assert(result.includes("1."));
    assert(result.includes("veryfront.config.js"));
    assert(result.includes("veryfront.config.ts"));
    assert(result.includes("veryfront.config.mjs"));
  });

  it("should format registered errors through their canonical slug", () => {
    const result = formatUserError(CONFIG_NOT_FOUND.create());

    assert(result.includes("How to fix:"));
    assert(result.includes("veryfront.config.ts"));
  });

  it("should fail closed for proxy errors and redact free-form credentials", () => {
    const source = new Error("Authorization: Bearer message-secret apiKey=key-secret");
    const hostile = new Proxy(source, {
      get(target, property, receiver) {
        if (property === "message") throw new Error("blocked");
        return Reflect.get(target, property, receiver);
      },
    });

    const output = formatUserError(hostile);

    assert(output.includes("Unknown error"));
    assertEquals(output.includes("message-secret"), false);
    assertEquals(output.includes("key-secret"), false);
  });

  it("should neutralize terminal and line injection in messages and stack frames", () => {
    const injection = "\x1b]2;owned\x07\x1b[2J\nFAKE SUCCESS";
    const error = new Error(`failure ${injection}`);
    error.stack = `Error: failure\n    at unsafe (${injection})`;

    const output = formatUserError(error);

    for (const forbidden of ["\x1b]2;owned", "\x1b[2J", "\x07", "\nFAKE SUCCESS"]) {
      assertEquals(output.includes(forbidden), false);
    }
  });

  it("should use one message snapshot for plain output and its solution", () => {
    let messageReads = 0;
    const stateful = new Proxy(new Error("unused"), {
      get(target, property, receiver): unknown {
        if (property === "message") {
          messageReads++;
          return messageReads === 1 ? "Port is in use" : "Build failed";
        }
        return Reflect.get(target, property, receiver);
      },
    });

    const output = formatUserError(stateful);

    assert(output.includes("Port is in use"));
    assert(output.includes("Port is already in use"));
    assertEquals(output.includes("Build failed with errors"), false);
    assertEquals(messageReads, 1);
  });
});
