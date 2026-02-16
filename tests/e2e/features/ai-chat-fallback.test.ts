#!/usr/bin/env -S deno test --allow-all
/**
 * Feature Tests: AI Chat Fallback (compiled binary)
 *
 * Tests the 503 NO_AI_AVAILABLE response when:
 * - No API keys are set
 * - Local AI is disabled via VERYFRONT_DISABLE_LOCAL_AI=1
 *
 * These tests are SLOW (~60s for binary compilation + server startup).
 * They are isolated from the fast test suite:
 *   - `deno task test` ignores tests/e2e/ entirely
 *   - Run explicitly: `deno test --allow-all tests/e2e/features/ai-chat-fallback.test.ts`
 *
 * Binary is cached after first compilation (~60s → ~2s on subsequent runs).
 */

import { beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import {
  createProject,
  ensureBinaryCompiled,
  pages,
  withServer,
} from "../setup/index.ts";

describe("Feature: AI Chat Fallback", {
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  beforeAll(async () => {
    await ensureBinaryCompiled();
  });

  it("should return 503 with NO_AI_AVAILABLE when no API key is set", async () => {
    // Use pages/ directory (simpler, known to work with e2e infra).
    // The chat API route registers an agent inline.
    const projectDir = await createProject("ai-fallback", pages.basic, {
      files: {
        "pages/api/chat.ts": `
import { agent, createChatHandler } from "veryfront/agent";

const assistant = agent({
  id: "test-assistant",
  model: "openai/gpt-4o",
  system: "You are a helpful test assistant.",
});

export const POST = createChatHandler("test-assistant");
`,
      },
    });

    // Longer timeout — agent imports are heavier than simple API routes.
    await withServer(projectDir, async (server) => {
      const response = await fetch(
        `http://127.0.0.1:${server.port}/api/chat`,
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

      assertEquals(response.status, 503, "Should return 503 when no AI available");

      const body = await response.json();
      assertEquals(body.code, "NO_AI_AVAILABLE");
      assertEquals(body.fallback, "browser");
      assertEquals(body.model, "smollm2-135m");
      assertEquals(body.systemPrompt, "You are a helpful test assistant.");
    }, {
      timeout: 60_000,
      env: {
        OPENAI_API_KEY: "",
        ANTHROPIC_API_KEY: "",
        GOOGLE_API_KEY: "",
        VERYFRONT_DISABLE_LOCAL_AI: "1",
      },
    });
  });

  it("should include system prompt from agent config in 503 response", async () => {
    const projectDir = await createProject("ai-fallback-prompt", pages.basic, {
      files: {
        "pages/api/chat.ts": `
import { agent, createChatHandler } from "veryfront/agent";

agent({
  id: "custom-bot",
  model: "openai/gpt-4o",
  system: "You are a pirate. Always say arrr.",
});

export const POST = createChatHandler("custom-bot");
`,
      },
    });

    await withServer(projectDir, async (server) => {
      const response = await fetch(
        `http://127.0.0.1:${server.port}/api/chat`,
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
      assertEquals(body.code, "NO_AI_AVAILABLE");
      assertEquals(body.systemPrompt, "You are a pirate. Always say arrr.");
    }, {
      timeout: 60_000,
      env: {
        OPENAI_API_KEY: "",
        ANTHROPIC_API_KEY: "",
        GOOGLE_API_KEY: "",
        VERYFRONT_DISABLE_LOCAL_AI: "1",
      },
    });
  });
});
