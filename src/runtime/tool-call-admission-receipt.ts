import { defineSchema } from "#veryfront/schemas/index.ts";

/** Receipt shape only; authenticated append and owner checks establish its provenance. */
export const getToolCallAdmissionReceiptSchema = defineSchema((v) =>
  v.object({
    occurrenceId: v.string().uuid(),
    admissionEventId: v.string().min(1),
    startEventId: v.string().min(1),
    toolCallId: v.string().min(1),
    publicToolCallId: v.string().min(1),
    projectId: v.string().uuid(),
    runId: v.string().uuid(),
  }).strict().transform((receipt) => ({
    ...receipt,
    occurrenceId: receipt.occurrenceId.toLowerCase(),
  }))
);

/** Closed wire receipt parser for canonical append acknowledgement payloads. */
export const getToolCallAdmissionWireReceiptSchema = defineSchema((v) =>
  v.object({
    occurrence_id: v.string().uuid(),
    admission_event_id: v.string().min(1),
    start_event_id: v.string().min(1),
    tool_call_id: v.string().min(1),
    public_tool_call_id: v.string().min(1),
    project_id: v.string().uuid(),
    run_id: v.string().uuid(),
  }).strict().transform((receipt) =>
    getToolCallAdmissionReceiptSchema().parse({
      occurrenceId: receipt.occurrence_id,
      admissionEventId: receipt.admission_event_id,
      startEventId: receipt.start_event_id,
      toolCallId: receipt.tool_call_id,
      publicToolCallId: receipt.public_tool_call_id,
      projectId: receipt.project_id,
      runId: receipt.run_id,
    })
  )
);

export type AgentRunToolCallAdmissionReceipt = ReturnType<
  ReturnType<typeof getToolCallAdmissionReceiptSchema>["parse"]
>;
