import type { AgUiRuntimeStreamEvent } from "./ag-ui-browser-encoder.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stripLeadingEmptyObjectPlaceholder(rawArgs: string): string {
  let normalized = rawArgs.trim();

  while (normalized.startsWith("{}") && normalized.slice(2).trimStart().startsWith("{")) {
    normalized = normalized.slice(2).trimStart();
  }

  return normalized;
}

export function mergeToolInputDelta(currentArguments: string, nextDelta: string): string {
  if (currentArguments === "{}" && nextDelta.trimStart().startsWith("{")) {
    return nextDelta;
  }

  return currentArguments + nextDelta;
}

export function mergeToolCallInput(currentArguments: string, nextInput: string): string {
  if (currentArguments.length === 0) {
    return nextInput;
  }

  if (nextInput.trim() === "{}" && currentArguments.trim().startsWith("{")) {
    return currentArguments;
  }

  if (currentArguments.trim() === "{}" && nextInput.trim().startsWith("{")) {
    return nextInput;
  }

  return nextInput;
}

export function parseToolInputObject(input: unknown): Record<string, unknown> {
  if (isRecord(input)) {
    return input;
  }

  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(stripLeadingEmptyObjectPlaceholder(input));
      if (isRecord(parsed)) {
        return parsed;
      }
    } catch {
      return {};
    }
  }

  return {};
}

export function parseDataStreamSseEvents(chunk: string): {
  events: AgUiRuntimeStreamEvent[];
  remainder: string;
} {
  const blocks = chunk.split("\n\n");
  const remainder = blocks.pop() ?? "";
  const events = blocks.flatMap((block) => {
    const dataLines = block.split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart());

    if (!dataLines.length) {
      return [];
    }

    try {
      return [JSON.parse(dataLines.join("\n")) as AgUiRuntimeStreamEvent];
    } catch {
      return [];
    }
  });

  return { events, remainder };
}

export async function* streamDataStreamEvents(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<AgUiRuntimeStreamEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let remainder = "";
  let completed = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        completed = true;
        break;
      }

      remainder += decoder.decode(value, { stream: true });
      const parsed = parseDataStreamSseEvents(remainder);
      remainder = parsed.remainder;

      for (const event of parsed.events) {
        yield event;
      }
    }

    remainder += decoder.decode();
    const parsed = parseDataStreamSseEvents(`${remainder}\n\n`);
    for (const event of parsed.events) {
      yield event;
    }
  } finally {
    if (!completed) {
      await reader.cancel().catch(() => undefined);
    }
    reader.releaseLock();
  }
}
