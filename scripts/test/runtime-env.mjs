/** Provider credentials and endpoint overrides runtime test lanes must not inherit. */
export const PROVIDER_ENV_KEYS = Object.freeze([
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "GOOGLE_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "GOOGLE_GEMINI_BASE_URL",
  "VERYFRONT_API_TOKEN",
  "VERYFRONT_API_BASE_URL",
  "VERYFRONT_API_URL",
  "VERYFRONT_PUBLIC_API_BASE_URL",
  "VERYFRONT_PROJECT_SLUG",
  "AG_UI_EVAL_PROJECT_SLUG",
  "TENANT_PROJECT_SLUG",
  "MISTRAL_API_KEY",
  "MISTRAL_BASE_URL",
  "GROQ_API_KEY",
  "GROQ_BASE_URL",
  "DEEPSEEK_API_KEY",
  "DEEPSEEK_BASE_URL",
  "OPENROUTER_API_KEY",
  "OPENROUTER_BASE_URL",
  "CONTEXT7_API_KEY",
]);

export function buildRuntimeTestProcessEnv(parentEnv, overrides = {}) {
  const env = { ...parentEnv, ...overrides };

  env.DENO_TESTING = "1";
  if (!env.VF_DISABLE_LRU_INTERVAL) env.VF_DISABLE_LRU_INTERVAL = "1";
  if (!env.NODE_ENV) env.NODE_ENV = "production";
  if (!env.LOG_FORMAT) env.LOG_FORMAT = "text";
  if (!env.VF_TEST_TIME_SCALE) env.VF_TEST_TIME_SCALE = "1";

  const scrubbed = new Set(PROVIDER_ENV_KEYS);
  for (const key of Object.keys(env)) {
    if (scrubbed.has(key.toUpperCase())) delete env[key];
  }
  return env;
}
