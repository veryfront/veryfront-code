import type {
  ModelRuntime,
  ModelRuntimeGenerateResult,
  ModelRuntimeStreamResult,
} from "#veryfront/provider/types.ts";

export async function collectAsync<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) {
    values.push(value);
  }
  return values;
}

type TestRuntimeOptions = {
  prompt: unknown[];
  tools?: unknown[];
  reasoning?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function getTestRuntimeOptions(options: unknown): TestRuntimeOptions {
  if (!isRecord(options) || !Array.isArray(options.prompt)) {
    throw new Error("Expected runtime options with a prompt array");
  }

  return {
    prompt: options.prompt,
    ...(Array.isArray(options.tools) ? { tools: options.tools } : {}),
    ...("reasoning" in options ? { reasoning: options.reasoning } : {}),
  };
}

const unusedGenerate: ModelRuntime["doGenerate"] = () =>
  Promise.reject(new Error("unused doGenerate"));
const unusedStream: ModelRuntime["doStream"] = () => Promise.reject(new Error("unused doStream"));

export function createGenerateModel(
  provider: string,
  modelId: string,
  doGenerate: (options: TestRuntimeOptions) => Promise<ModelRuntimeGenerateResult>,
): ModelRuntime {
  return {
    provider,
    modelId,
    specificationVersion: "v3",
    doGenerate: (options) => doGenerate(getTestRuntimeOptions(options)),
    doStream: unusedStream,
  };
}

export function createStreamModel(
  provider: string,
  modelId: string,
  doStream: (options: TestRuntimeOptions) => Promise<ModelRuntimeStreamResult>,
): ModelRuntime {
  return {
    provider,
    modelId,
    specificationVersion: "v3",
    doGenerate: unusedGenerate,
    doStream: (options) => doStream(getTestRuntimeOptions(options)),
  };
}
