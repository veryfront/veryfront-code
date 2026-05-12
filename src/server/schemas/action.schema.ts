import { defineSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";

/** Action payload from client for RSC server actions */
export const getActionPayloadSchema = defineSchema((v) =>
  v.object({
    id: v.string().min(1),
    args: v.array(v.unknown()).max(50).optional().default([]),
  })
);

export type ActionPayload = InferSchema<ReturnType<typeof getActionPayloadSchema>>;

// Backward compat alias
export const ActionPayloadSchema = getActionPayloadSchema();
