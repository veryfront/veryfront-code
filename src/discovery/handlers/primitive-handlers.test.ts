import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { type Resource, resource, resourceRegistry } from "#veryfront/resource";
import { promptRegistry } from "#veryfront/prompt";
import { promptHandler } from "./prompt-handler.ts";
import { resourceHandler } from "./resource-handler.ts";

Deno.test("resource discovery validates the complete runtime boundary", () => {
  assertEquals(
    resourceHandler.validate({
      description: "Docs",
      paramsSchema: defineSchema((v) => v.object({}))(),
      load: () => ({}),
    }),
    true,
  );
  assertEquals(resourceHandler.validate({ load: () => ({}) }), false);
  assertEquals(
    resourceHandler.validate({
      description: "Docs",
      paramsSchema: {},
      load: () => ({}),
    }),
    false,
  );
  assertEquals(
    resourceHandler.validate({
      description: "Docs",
      paramsSchema: defineSchema((v) => v.object({}))(),
      load: () => ({}),
      subscribe: "not-a-function",
    }),
    false,
  );
});

Deno.test("resource discovery derives metadata for a valid literal resource export", () => {
  const literal = {
    description: "Docs",
    paramsSchema: defineSchema((v) => v.object({}))(),
    load: () => ({}),
  };

  try {
    assertEquals(resourceHandler.validate(literal), true);
    const registered = resourceHandler.register(
      "docs",
      literal as unknown as Resource,
      "/project/resources/docs.ts",
      "/project/resources",
    );
    assertEquals(registered.id, "docs");
    assertEquals(registered.pattern, "/docs");
  } finally {
    resourceRegistry.delete("docs");
  }
});

Deno.test("resource discovery preserves explicit patterns and replaces generated placeholders", () => {
  const explicit = resource({
    pattern: "docs://project",
    description: "Project docs",
    paramsSchema: defineSchema((v) => v.object({}))(),
    load: () => ({}),
  });
  const generated = resource({
    description: "User profile",
    paramsSchema: defineSchema((v) => v.object({ id: v.string() }))(),
    load: () => ({}),
  });

  try {
    const registeredExplicit = resourceHandler.register(
      "docs",
      explicit as unknown as Resource,
      "/project/resources/docs.ts",
      "/project/resources",
    );
    assertEquals(registeredExplicit.pattern, "docs://project");

    const registeredGenerated = resourceHandler.register(
      "profile",
      generated as unknown as Resource,
      "/project/resources/users/[id]/profile.ts",
      "/project/resources",
    );
    assertEquals(registeredGenerated.pattern, "/users/:id/profile");
  } finally {
    resourceRegistry.delete("docs");
    resourceRegistry.delete("profile");
  }
});

Deno.test("prompt discovery validates description and optional suggestion", () => {
  assertEquals(
    promptHandler.validate({
      description: "Welcome",
      getContent: () => Promise.resolve("Hello"),
    }),
    true,
  );
  assertEquals(promptHandler.validate({ getContent: () => Promise.resolve("Hello") }), false);
  assertEquals(
    promptHandler.validate({
      description: "Welcome",
      suggestion: 42,
      getContent: () => Promise.resolve("Hello"),
    }),
    false,
  );
});

Deno.test("prompt discovery derives an id for a valid literal prompt export", () => {
  const literal = {
    description: "Welcome",
    getContent: () => Promise.resolve("Hello"),
  };

  try {
    assertEquals(promptHandler.validate(literal), true);
    const id = promptHandler.getId(
      literal as never,
      "/project/prompts/welcome-message.ts",
      "/project/prompts",
    );
    const registered = promptHandler.register(
      id,
      literal as never,
      "/project/prompts/welcome-message.ts",
      "/project/prompts",
    );
    assertEquals(registered.id, "welcomeMessage");
  } finally {
    promptRegistry.delete("welcomeMessage");
  }
});

Deno.test("prompt discovery preserves explicit ids and replaces generated placeholders", () => {
  const explicit = {
    id: "configured_prompt",
    description: "Configured",
    getContent: () => Promise.resolve("Configured"),
  };
  assertEquals(
    promptHandler.getId(explicit, "/project/prompts/file-name.ts", "/project/prompts"),
    "configured_prompt",
  );

  const generated = {
    ...explicit,
    id: "prompt_123_0",
    __veryfrontGeneratedId: "prompt_123_0",
  };
  assertEquals(
    promptHandler.getId(generated, "/project/prompts/file-name.ts", "/project/prompts"),
    "fileName",
  );
});
