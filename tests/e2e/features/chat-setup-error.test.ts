#!/usr/bin/env -S deno test --allow-all
/**
 * Feature tests: chat setup errors (compiled binary)
 *
 * Tests the 503 NO_MODEL_CREDENTIALS response when:
 * - No API keys are set
 *
 * These tests are SLOW (~60s for binary compilation + server startup).
 * They are isolated from the fast test suite:
 *   - `deno task test` ignores tests/e2e/ entirely
 *   - Run explicitly: `deno test --allow-all tests/e2e/features/chat-setup-error.test.ts`
 *
 * Binary is cached after first compilation (~60s → ~2s on subsequent runs).
 */
import "../../_helpers/contract-init.ts";

import { beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { createProject, ensureBinaryCompiled, pages, withServer } from "../setup/index.ts";

describe("Feature: chat setup errors", {
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  beforeAll(async () => {
    await ensureBinaryCompiled();
  });

  it("should return 503 with NO_MODEL_CREDENTIALS when no API key is set", async () => {
    // Use pages/ directory (simpler, known to work with e2e infra).
    // The AG-UI API route registers an agent inline.
    const projectDir = await createProject("ai-setup-error", pages.basic, {
      files: {
        "pages/api/ag-ui.ts": `
import { agent, createAgUiHandler } from "veryfront/agent";

const assistant = agent({
  id: "test-assistant",
  model: "openai/gpt-4o",
  system: "You are a helpful test assistant.",
});

export const POST = createAgUiHandler("test-assistant");
`,
      },
    });

    // Longer timeout — agent imports are heavier than simple API routes.
    await withServer(projectDir, async (server) => {
      const response = await fetch(
        `http://127.0.0.1:${server.port}/api/ag-ui`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [
              {
                id: "msg-1",
                role: "user",
                parts: [{ type: "text", text: "Hello" }],
              },
            ],
          }),
        },
      );

      assertEquals(response.status, 503, "Should return 503 when model credentials are missing");

      const body = await response.json();
      assertEquals(body.code, "NO_MODEL_CREDENTIALS");
      assertEquals(
        body.error,
        "No model credentials configured. Run veryfront login or set VERYFRONT_API_TOKEN, OPENAI_API_KEY, ANTHROPIC_API_KEY, or GOOGLE_API_KEY.",
      );
      assertEquals(body.systemPrompt, undefined);
    }, {
      timeout: 60_000,
      env: {
        OPENAI_API_KEY: "",
        ANTHROPIC_API_KEY: "",
        GOOGLE_API_KEY: "",
      },
    });
  });

  it("should not expose the agent system prompt in the 503 setup response", async () => {
    const projectDir = await createProject("ai-setup-error-prompt", pages.basic, {
      files: {
        "pages/api/ag-ui.ts": `
import { agent, createAgUiHandler } from "veryfront/agent";

agent({
  id: "custom-bot",
  model: "openai/gpt-4o",
  system: "You are a pirate. Always say arrr.",
});

export const POST = createAgUiHandler("custom-bot");
`,
      },
    });

    await withServer(projectDir, async (server) => {
      const response = await fetch(
        `http://127.0.0.1:${server.port}/api/ag-ui`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [
              {
                id: "msg-1",
                role: "user",
                parts: [{ type: "text", text: "ahoy" }],
              },
            ],
          }),
        },
      );

      assertEquals(response.status, 503);
      const body = await response.json();
      assertEquals(body.code, "NO_MODEL_CREDENTIALS");
      assertEquals(body.systemPrompt, undefined);
    }, {
      timeout: 60_000,
      env: {
        OPENAI_API_KEY: "",
        ANTHROPIC_API_KEY: "",
        GOOGLE_API_KEY: "",
      },
    });
  });
});
