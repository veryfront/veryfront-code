/**
 * How a reader gets inference for local agents, in one place so `init` and
 * `dev` give the same answer.
 *
 * The Cloud AI Gateway needs a linked project. The `dev` prompt links one and
 * starts connected dev, which syncs the source to the project's Cloud preview
 * (`createConnectedDevSourceSync`), so the copy must disclose that sync. Point
 * readers at that prompt, not `veryfront push`: push uploads the source without
 * starting dev, so it is not the direct way to gateway inference in local dev.
 */

/** Provider keys the runtime reads from the environment for direct inference. */
export const PROVIDER_KEY_ENV_NAMES = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "MISTRAL_API_KEY",
] as const;

/**
 * Heading for the setup hint. It names what was checked instead of claiming no
 * model can run: a project can use `local/...` models, or a provider it
 * registers in code, which the CLI cannot see.
 */
export const NO_INFERENCE_HEADING =
  "No provider key or linked Cloud project found. To use hosted models, choose one:";

/**
 * Shown after the options in `dev` only: `dev` reads `.env` once at startup
 * (`loadDevProjectEnv`), so a key added while it runs needs a restart.
 */
export const DEV_ENV_RESTART_LINE = "After you edit .env, restart veryfront dev.";

/** The two ways to get inference, as indented list lines without a heading. */
export function inferenceSetupOptionLines(): string[] {
  const [defaultKey, ...otherKeys] = PROVIDER_KEY_ENV_NAMES;
  const otherKeyNames = `${otherKeys.slice(0, -1).join(", ")}, or ${otherKeys.at(-1)}`;
  return [
    '- Veryfront Cloud AI Gateway: run veryfront login, then run veryfront dev and answer Yes to "Use Veryfront Cloud?". This links a Cloud project, and veryfront dev syncs your source to its Cloud preview.',
    "  To use your own OpenAI or Anthropic key through the gateway, store it in Studio under Account settings > Provider keys.",
    `- Your own key, on this machine: set ${defaultKey} in .env, which works with the default model.`,
    // The default agent model is openai/gpt-5-nano; another provider's key
    // alone fails with default-model-credential-mismatch.
    `  For ${otherKeyNames}, also set your agent's model to "auto" or "<provider>/<model>".`,
  ];
}
