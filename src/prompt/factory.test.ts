import { describe, it } from "#veryfront/testing/bdd";
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert";
import { prompt } from "./factory.ts";

describe("prompt factory", () => {
  describe("prompt()", () => {
    it("should create a prompt with explicit id", () => {
      const p = prompt({ id: "my-prompt", description: "A test prompt", content: "Hello" });
      assertEquals(p.id, "my-prompt");
      assertEquals(p.description, "A test prompt");
    });

    it("should auto-generate id when not provided", () => {
      const p = prompt({ description: "auto-id", content: "Hello" });
      assertStringIncludes(p.id, "prompt_");
    });

    it("should preserve suggestion field", () => {
      const p = prompt({
        id: "suggest",
        description: "desc",
        content: "Hello",
        suggestion: "Try asking me about...",
      });
      assertEquals(p.suggestion, "Try asking me about...");
    });
  });

  describe("getContent() with static content", () => {
    it("should return static content without variables", async () => {
      const p = prompt({ id: "static", description: "desc", content: "Hello world" });
      assertEquals(await p.getContent(), "Hello world");
    });

    it("should interpolate variables in template", async () => {
      const p = prompt({
        id: "template",
        description: "desc",
        content: "Hello {name}, welcome to {place}!",
      });
      const result = await p.getContent({ name: "Alice", place: "Wonderland" });
      assertEquals(result, "Hello Alice, welcome to Wonderland!");
    });

    it("should leave unmatched placeholders unchanged", async () => {
      const p = prompt({
        id: "partial",
        description: "desc",
        content: "Hello {name}, your id is {id}",
      });
      const result = await p.getContent({ name: "Bob" });
      assertEquals(result, "Hello Bob, your id is {id}");
    });

    it("should convert non-string variable values to strings", async () => {
      const p = prompt({
        id: "convert",
        description: "desc",
        content: "Count: {count}, active: {active}",
      });
      const result = await p.getContent({ count: 42, active: true });
      assertEquals(result, "Count: 42, active: true");
    });

    it("should not replace when variable value is null", async () => {
      const p = prompt({
        id: "null-var",
        description: "desc",
        content: "Value: {val}",
      });
      const result = await p.getContent({ val: null });
      assertEquals(result, "Value: {val}");
    });

    it("should not replace when variable value is undefined", async () => {
      const p = prompt({
        id: "undef-var",
        description: "desc",
        content: "Value: {val}",
      });
      const result = await p.getContent({ val: undefined });
      assertEquals(result, "Value: {val}");
    });
  });

  describe("getContent() with generate function", () => {
    it("should call generate function with variables", async () => {
      const p = prompt({
        id: "gen",
        description: "desc",
        generate: (vars) => `Generated: ${vars.input}`,
      });
      const result = await p.getContent({ input: "test" });
      assertEquals(result, "Generated: test");
    });

    it("should support async generate function", async () => {
      const p = prompt({
        id: "async-gen",
        description: "desc",
        generate: async (vars) => `Async: ${vars.value}`,
      });
      const result = await p.getContent({ value: "hello" });
      assertEquals(result, "Async: hello");
    });

    it("should pass empty object when no variables provided", async () => {
      let receivedVars: Record<string, unknown> | undefined;
      const p = prompt({
        id: "no-vars",
        description: "desc",
        generate: (vars) => {
          receivedVars = vars;
          return "ok";
        },
      });
      await p.getContent();
      assertEquals(receivedVars, {});
    });
  });

  describe("getContent() error handling", () => {
    it("should throw when prompt has neither content nor generate", async () => {
      const p = prompt({ id: "empty", description: "desc" });
      await assertRejects(
        () => p.getContent(),
        Error,
        'Prompt "empty" has no content or generator',
      );
    });
  });
});
