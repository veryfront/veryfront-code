/**
 * How a reader gets inference for local agents, in one place so `init` and
 * `dev` give the same answer.
 *
 * Linking a project is enough for the Cloud AI Gateway, and the `init` and `dev`
 * prompts link without publishing. Do not point readers at `veryfront push` for
 * inference: it publishes the source.
 */

/** Provider keys the runtime reads from the environment for direct inference. */
export const PROVIDER_KEY_ENV_NAMES = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "MISTRAL_API_KEY",
] as const;

/** The two ways to get inference, as indented list lines without a heading. */
export function inferenceSetupOptionLines(): string[] {
  const keyNames = `${PROVIDER_KEY_ENV_NAMES.slice(0, -1).join(", ")}, or ${
    PROVIDER_KEY_ENV_NAMES.at(-1)
  }`;
  return [
    '- Veryfront Cloud AI Gateway: run veryfront login, then run veryfront dev and answer Yes to "Use Veryfront Cloud?". This links a project and publishes nothing.',
    "  To use your own OpenAI or Anthropic key through the gateway, store it in Studio under Account settings > Provider keys.",
    `- Your own key, on this machine: set ${keyNames} in .env.`,
  ];
}
