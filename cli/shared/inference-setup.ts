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
 * The model the runtime gives an agent that sets none (`DEFAULT_AGENT_MODEL`
 * in the agent runtime). Without the gateway it needs `OPENAI_API_KEY`.
 */
export const DEFAULT_AGENT_MODEL_NAME = "openai/gpt-5-nano";

/**
 * The `dev` banner warning for provider keys the default model cannot use:
 * an agent sets no model, and neither the gateway nor an OpenAI key can serve
 * the default, so the first request fails with
 * `default-model-credential-mismatch`. The keys stay listed under Inference:
 * a request can still pick a model of their provider.
 */
export function defaultModelKeyMismatchLine(keyNames: readonly string[]): string {
  const names = keyNames.length > 1
    ? `${keyNames.slice(0, -1).join(", ")} or ${keyNames.at(-1)}`
    : keyNames[0];
  return `Agents that set no model use "${DEFAULT_AGENT_MODEL_NAME}", which needs OPENAI_API_KEY. To use ${names}, set the agent's model to "auto" or "<provider>/<model>".`;
}

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
