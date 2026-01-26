import type { Message } from "../types.js";

export function normalizeInput(input: string | Message[]): Message[] {
  const now = Date.now();

  if (typeof input === "string") {
    return [
      {
        id: `msg_${now}`,
        role: "user",
        parts: [{ type: "text", text: input }],
        timestamp: now,
      },
    ];
  }

  return input.map((msg, index) => {
    if (typeof msg.id === "string" && msg.id.trim().length === 0) {
      throw new Error("Message id cannot be empty.");
    }

    const id = msg.id ?? `msg_${now}_${index}`;
    return {
      ...msg,
      id,
      timestamp: msg.timestamp ?? now,
    };
  });
}

export function accumulateUsage(
  total: { promptTokens: number; completionTokens: number; totalTokens: number },
  usage: { promptTokens?: number; completionTokens?: number; totalTokens?: number },
): void {
  total.promptTokens += usage.promptTokens ?? 0;
  total.completionTokens += usage.completionTokens ?? 0;
  total.totalTokens += usage.totalTokens ?? 0;
}

export function getMaxSteps(
  configuredMaxSteps: number | undefined,
  edgeMaxSteps: number | undefined,
  platformLimit: number,
  defaultMaxSteps: number = 20,
): number {
  const effectiveMaxSteps = edgeMaxSteps ?? configuredMaxSteps ?? defaultMaxSteps;
  return Math.min(effectiveMaxSteps, platformLimit);
}
