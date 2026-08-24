/**
 * Install Veryfront test isolation before test modules and their dependencies.
 *
 * Use this module with `deno test --preload=src/testing/preload.ts` when test
 * dependencies can mutate process environment variables during evaluation.
 *
 * @module testing/preload
 */

import "./bdd.ts";
import "../schemas/_test-setup.ts";
import { __installUnpinnedHostTransportForTests } from "../security/http/outbound-fetch.ts";
for (
  const key of [
    "VERYFRONT_API_TOKEN",
    "VERYFRONT_API_BASE_URL",
    "VERYFRONT_API_URL",
    "VERYFRONT_PROJECT_SLUG",
    "AG_UI_EVAL_PROJECT_SLUG",
    "TENANT_PROJECT_SLUG",
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_BASE_URL",
    "GOOGLE_API_KEY",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "GOOGLE_GEMINI_BASE_URL",
    "MISTRAL_API_KEY",
    "MISTRAL_BASE_URL",
    "GROQ_API_KEY",
    "GROQ_BASE_URL",
    "DEEPSEEK_API_KEY",
    "DEEPSEEK_BASE_URL",
    "OPENROUTER_API_KEY",
    "OPENROUTER_BASE_URL",
    "CONTEXT7_API_KEY",
  ]
) Deno.env.delete(key);

// Tests that genuinely reach the network use the plain host transport rather
// than Deno's pinned SOCKS client, which holds connections open past the end of
// a test. Installing it here keeps the security module to a single rule and
// leaves the test-only decision somewhere a reader can find it.
__installUnpinnedHostTransportForTests();
