import { defineSchema } from "#veryfront/schemas/index.ts";

/** Receipt shape only; authenticated append and owner checks establish its provenance. */
export const getModelCallCaptureReceiptSchema = defineSchema((v) =>
  v.object({
    eventId: v.string().min(1),
    projectId: v.string().uuid(),
    runId: v.string().uuid(),
    modelCallId: v.string().uuid(),
  }).strict()
);

export type AgentRunModelCallCaptureReceipt = ReturnType<
  ReturnType<typeof getModelCallCaptureReceiptSchema>["parse"]
>;
