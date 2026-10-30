import type { LLMProviderConfig } from "veryfront/extensions/llm";
import type {
  DecisionAnswer,
  DecisionQuestion,
  DecisionResult,
  DecisionRuntime,
} from "veryfront/provider/types";
import {
  createOpenAIRequestInit,
  createOriginBoundOutboundFetch,
  getOpenAIDecisionsUrl,
  ProviderRequestError,
  readRecord,
  requestJson,
  snapshotProviderJsonValue,
} from "veryfront/provider/shared";

const DECISION_QUESTION_MAX_NODES = 1_000_000;
const DECISION_INPUT_MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024;
const DECISION_QUESTIONS_MAX_SNAPSHOT_BYTES = 512 * 1024 * 1024;
const DECISION_INPUT_MAX_TEXT_CHARACTERS = 10_485_760;
const DECISION_QUESTION_MAX_TEXT_CHARACTERS = 1_048_576;
const DECISION_RESPONSE_MAX_BYTES = 256 * 1024 * 1024;

function characterCount(value: string): number {
  let count = 0;
  for (const _character of value) count++;
  return count;
}

function requireString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string") throw new TypeError(`${field} must be a string`);
}

function requireArray(value: unknown, field: string, min: number, max: number): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new TypeError(`${field} must contain between ${min} and ${max} entries`);
  }
  return value;
}

function buildContent(
  value: unknown,
  {
    minItems = 0,
    maxBytes = 262_144,
    maxTextCharacters = DECISION_QUESTION_MAX_TEXT_CHARACTERS,
    maxTextPartCharacters = maxTextCharacters,
  }: {
    minItems?: number;
    maxBytes?: number;
    maxTextCharacters?: number;
    maxTextPartCharacters?: number;
  } = {},
): string | Record<string, unknown>[] {
  if (typeof value === "string") {
    if (characterCount(value) > maxTextCharacters) {
      throw new TypeError(`Decision text exceeds ${maxTextCharacters} characters`);
    }
    return value;
  }
  return requireArray(value, "Decision content", minItems, 16384).map((part) => {
    const item = readRecord(part);
    if (item?.type === "text") {
      requireString(item.text, "Decision text");
      if (characterCount(item.text) > maxTextPartCharacters) {
        throw new TypeError(`Decision text exceeds ${maxTextPartCharacters} characters`);
      }
      return { type: "input_text", text: item.text };
    }
    if (item?.type === "image") {
      requireString(item.url, "Decision image URL");
      if (!/^(https?:\/\/|data:image\/)/.test(item.url)) {
        throw new TypeError("Decision images require HTTP(S) URLs or image data URLs");
      }
      return { type: "input_image", image_url: item.url };
    }
    if (item?.type === "json") {
      const data = item.data;
      if (!readRecord(data) && !(Array.isArray(data) && data.every((entry) => readRecord(entry)))) {
        throw new TypeError("Decision JSON must be an object or array of objects");
      }
      return {
        type: "input_json",
        data: snapshotProviderJsonValue(data, { maxDepth: 32, maxNodes: 10000, maxBytes }),
      };
    }
    throw new TypeError("Unsupported decision content type");
  });
}

function validateOptions(value: unknown, kind: "choice" | "score"): void {
  const items = requireArray(value, `Decision ${kind} options`, 2, kind === "choice" ? 255 : 10);
  const values = new Set<string | boolean>();
  for (const option of items) {
    const item = readRecord(option);
    const label = kind === "choice" ? item?.value : item?.label;
    if (typeof label !== "string" && !(kind === "choice" && typeof label === "boolean")) {
      throw new TypeError(`Invalid decision ${kind} option`);
    }
    if (kind === "choice" && values.has(label)) {
      throw new TypeError("Decision choice values must be unique");
    }
    values.add(label);
    if (item?.description !== undefined) {
      requireString(item.description, "Decision option description");
    }
  }
}

function buildQuestions(value: unknown): {
  questions: DecisionQuestion[];
  wireQuestions: Record<string, unknown>[];
} {
  const questions = requireArray(value, "Decision questions", 1, 400);
  const names = new Set<string>();
  const wireQuestions = questions.map((value) => {
    const item = readRecord(value);
    requireString(item?.name, "Decision question name");
    if (!item.name.trim() || names.has(item.name)) {
      throw new TypeError("Decision question names must be non-empty and unique");
    }
    names.add(item.name);
    const common = {
      name: item.name,
      instructions: buildContent(item.instructions, {
        minItems: 1,
        maxTextPartCharacters: DECISION_INPUT_MAX_TEXT_CHARACTERS,
      }),
    };
    if (item.type === "predicate") return { ...common, type: "predicate" };
    if (item.type === "choice") {
      validateOptions(item.choices, "choice");
      return { ...common, type: "choice", choices: item.choices };
    }
    if (item.type === "score") {
      validateOptions(item.levels, "score");
      return { ...common, type: "score", levels: item.levels };
    }
    throw new TypeError("Unsupported decision question type");
  });
  return { questions: questions as DecisionQuestion[], wireQuestions };
}

function probability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function invalidResponse(provider: string): ProviderRequestError {
  return new ProviderRequestError({
    provider,
    status: 200,
    retryable: false,
    message: `${provider} decisions returned an invalid successful response`,
  });
}

function readAnswer(value: unknown, question: DecisionQuestion, provider: string): DecisionAnswer {
  const answer = readRecord(value);
  if (answer?.name !== question.name) throw invalidResponse(provider);
  const name = question.name;
  if (answer.type === "refusal") return { type: "refusal", name };
  if (answer.type !== question.type) throw invalidResponse(provider);
  if (question.type === "predicate") {
    if (!probability(answer.probability)) throw invalidResponse(provider);
    return { type: "predicate", name, probability: answer.probability };
  }
  if (!probability(answer.confidence) || !Array.isArray(answer.probabilities)) {
    throw invalidResponse(provider);
  }
  if (question.type === "choice") {
    const expected = new Set(question.choices.map((option) => option.value));
    if (!expected.has(answer.choice as string | boolean)) throw invalidResponse(provider);
    const probabilities = answer.probabilities.map((entry) => {
      const item = readRecord(entry);
      if (
        !item || !expected.delete(item.value as string | boolean) || !probability(item.probability)
      ) {
        throw invalidResponse(provider);
      }
      return { value: item.value as string | boolean, probability: item.probability };
    });
    return {
      type: "choice",
      name,
      choice: answer.choice as string | boolean,
      confidence: answer.confidence,
      probabilities,
    };
  }
  if (
    typeof answer.score !== "number" || !Number.isFinite(answer.score) || answer.score < 0 ||
    answer.score > question.levels.length - 1
  ) throw invalidResponse(provider);
  const expected = new Set(question.levels.map((_, index) => index));
  const probabilities = answer.probabilities.map((entry) => {
    const item = readRecord(entry);
    if (
      !item || !expected.delete(item.value as number) || !probability(item.probability) ||
      item.label !== question.levels[item.value as number]?.label
    ) throw invalidResponse(provider);
    return {
      value: item.value as number,
      label: item.label as string,
      probability: item.probability,
    };
  });
  return { type: "score", name, score: answer.score, confidence: answer.confidence, probabilities };
}

function tokenCount(value: unknown, provider: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw invalidResponse(provider);
  }
  return value;
}

function readResult(
  payload: unknown,
  questions: readonly DecisionQuestion[],
  provider: string,
): DecisionResult {
  const body = readRecord(payload);
  const usage = readRecord(body?.usage);
  if (
    !body || typeof body.model !== "string" || !body.model || !usage ||
    !Array.isArray(body.answers) || body.answers.length !== questions.length
  ) throw invalidResponse(provider);
  const details = readRecord(usage.input_tokens_details);
  const answers = body.answers;
  return {
    model: body.model,
    answers: questions.map((question, index) => readAnswer(answers[index], question, provider)),
    usage: {
      inputTokens: tokenCount(usage.input_tokens, provider),
      outputTokens: tokenCount(usage.output_tokens, provider),
      totalTokens: tokenCount(usage.total_tokens, provider),
      ...(details?.cached_tokens === undefined
        ? {}
        : { cachedInputTokens: tokenCount(details.cached_tokens, provider) }),
      ...(details?.cache_write_tokens === undefined
        ? {}
        : { cacheCreationInputTokens: tokenCount(details.cache_write_tokens, provider) }),
    },
  };
}

/** Direct-provider Decisions runtime. Uses the same guarded HTTP transport as other OpenAI calls. */
export function createOpenAIDecisionsRuntime(
  modelId: string,
  config: LLMProviderConfig,
): DecisionRuntime {
  if (typeof modelId !== "string" || !modelId.trim() || modelId !== modelId.trim()) {
    throw new TypeError("Decision model ID must be a non-empty trimmed string");
  }
  const url = getOpenAIDecisionsUrl(config.baseURL);
  const apiKey = config.credential;
  const fetchImpl = config.fetch ?? createOriginBoundOutboundFetch(url);
  const providerLabel = typeof config.name === "string" && config.name.trim()
    ? config.name.trim()
    : "openai";
  return {
    provider: providerLabel,
    modelId,
    async decide(options) {
      options.abortSignal?.throwIfAborted();
      const input = buildContent(
        snapshotProviderJsonValue(options.input, {
          maxBytes: DECISION_INPUT_MAX_SNAPSHOT_BYTES,
        }),
        { maxBytes: 262_144, maxTextCharacters: DECISION_INPUT_MAX_TEXT_CHARACTERS },
      );
      const { questions, wireQuestions } = buildQuestions(
        snapshotProviderJsonValue(options.questions, {
          dropUndefinedMembers: true,
          maxNodes: DECISION_QUESTION_MAX_NODES,
          maxBytes: DECISION_QUESTIONS_MAX_SNAPSHOT_BYTES,
        }),
      );
      const promptCacheKey = options.promptCacheKey;
      if (promptCacheKey !== undefined) {
        requireString(promptCacheKey, "Decision prompt cache key");
        if (characterCount(promptCacheKey) > 64) {
          throw new TypeError("Decision prompt cache key exceeds 64 characters");
        }
      }
      const payload = await requestJson({
        url,
        fetchImpl,
        providerLabel,
        providerKind: "openai",
        modelId,
        timeoutMs: options.timeoutMs,
        maxResponseBytes: DECISION_RESPONSE_MAX_BYTES,
        init: createOpenAIRequestInit({
          apiKey,
          signal: options.abortSignal,
          body: JSON.stringify({
            model: modelId,
            input: typeof input === "string" ? input : [{ role: "user", content: input }],
            questions: wireQuestions,
            ...(promptCacheKey === undefined ? {} : { prompt_cache_key: promptCacheKey }),
          }),
        }),
      });
      return readResult(payload, questions, providerLabel);
    },
  };
}
