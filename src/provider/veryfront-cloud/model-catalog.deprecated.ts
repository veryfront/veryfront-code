/**
 * Deprecated model list exports, backed by the table shipped in this package.
 *
 * Model facts now come from the served catalog (`catalog-client.ts`), and no
 * resolution logic reads this module. It keeps the public exports that only
 * make sense with a shipped list working for one release, and it is the only
 * module that imports the shipped table.
 */
import type { KnownVeryfrontCloudProviderId, VeryfrontCloudChatModel } from "./model-catalog.ts";
import {
  DEFAULT_VERYFRONT_CLOUD_MODEL_ID as TABLE_DEFAULT_MODEL_ID,
  VERYFRONT_CLOUD_CHAT_MODEL_ENTRIES,
  VERYFRONT_CLOUD_PROVIDER_ALIASES,
  VERYFRONT_CLOUD_PROVIDER_LABELS as PROVIDER_LABELS,
  VERYFRONT_CLOUD_PROVIDER_ORDER as PROVIDER_ORDER,
} from "./model-catalog.data.ts";

const MODEL_PREFIX = "veryfront-cloud/";
const providerAliases: ReadonlyMap<string, string> = new Map(VERYFRONT_CLOUD_PROVIDER_ALIASES);

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/** `<canonical provider>/<model>` by the shipped alias list, prefix removed. */
function tableModelKey(modelId: string): string {
  const normalized = modelId.startsWith(MODEL_PREFIX)
    ? modelId.slice(MODEL_PREFIX.length)
    : modelId;
  const slashIndex = normalized.indexOf("/");
  if (slashIndex <= 0) return normalized;
  const provider = normalized.slice(0, slashIndex);
  return `${providerAliases.get(provider) ?? provider}/${normalized.slice(slashIndex + 1)}`;
}

/**
 * Chat models shipped with this package.
 *
 * @deprecated Read the served catalog instead. This list is removed in a later release.
 */
export const VERYFRONT_CLOUD_CHAT_MODELS: readonly VeryfrontCloudChatModel[] = Object.freeze(
  VERYFRONT_CLOUD_CHAT_MODEL_ENTRIES.map((model) => {
    if (
      model.thinkingBudgetTokens !== undefined &&
      !isPositiveSafeInteger(model.thinkingBudgetTokens)
    ) {
      throw new TypeError(
        `Veryfront Cloud model "${model.id}" thinkingBudgetTokens must be a positive safe integer`,
      );
    }
    return Object.freeze(model);
  }),
);

const defaultVeryfrontCloudChatModel = VERYFRONT_CLOUD_CHAT_MODELS.find(
  (model) => model.id === TABLE_DEFAULT_MODEL_ID,
);
if (!defaultVeryfrontCloudChatModel) {
  throw new Error(
    `Veryfront Cloud default model "${TABLE_DEFAULT_MODEL_ID}" is missing from the catalog`,
  );
}

/**
 * Shipped descriptor of the built-in default model.
 *
 * @deprecated Read the served catalog instead. This descriptor is removed in a later release.
 */
export const DEFAULT_VERYFRONT_CLOUD_CHAT_MODEL = defaultVeryfrontCloudChatModel;

/**
 * Find a shipped chat model by its short id.
 *
 * @deprecated Read the served catalog instead. This lookup is removed in a later release.
 */
export function findVeryfrontCloudModel(
  id: string,
): VeryfrontCloudChatModel | undefined {
  return VERYFRONT_CLOUD_CHAT_MODELS.find((model) => model.id === id);
}

/**
 * Find a shipped chat model by its provider-qualified id, in any provider spelling.
 *
 * @deprecated Read the served catalog instead. This lookup is removed in a later release.
 */
export function findVeryfrontCloudModelByModelId(
  modelId: string,
): VeryfrontCloudChatModel | undefined {
  const key = tableModelKey(modelId);
  return VERYFRONT_CLOUD_CHAT_MODELS.find((model) => tableModelKey(model.modelId) === key);
}

/**
 * Group the shipped chat models by provider, in display order.
 *
 * @deprecated Read the served catalog instead. This grouping is removed in a later release.
 */
export function groupVeryfrontCloudModelsByProvider(): Array<{
  readonly provider: KnownVeryfrontCloudProviderId;
  readonly label: string;
  readonly models: readonly VeryfrontCloudChatModel[];
}> {
  return PROVIDER_ORDER.map((provider) => ({
    provider,
    label: PROVIDER_LABELS[provider],
    models: Object.freeze(
      VERYFRONT_CLOUD_CHAT_MODELS.filter((model) => model.provider === provider),
    ),
  })).filter((group) => group.models.length > 0);
}
