import type { AttributeValue } from "#veryfront/observability";

const CONTEXT_ATTRIBUTE_KEYS = [
  "project_id",
  "project_slug",
  "environment",
  "branch",
] as const;

export function attributesKey(attributes: Record<string, AttributeValue>): string {
  return JSON.stringify(
    Object.entries(attributes)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, value]),
  );
}

export function createOverflowAttributes(
  attributes: Record<string, AttributeValue>,
): Record<string, AttributeValue> {
  const overflow: Record<string, AttributeValue> = {
    "otel.metric.overflow": true,
  };
  for (const key of CONTEXT_ATTRIBUTE_KEYS) {
    const value = attributes[key];
    if (value !== undefined && value !== null) overflow[key] = value;
  }
  return overflow;
}
