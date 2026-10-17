import { defineSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import {
  getRecoveryContinuationSchema,
  getRecoveryModelTurnSchema,
  getRecoverySnapshotSchema,
} from "./recovery-snapshot.ts";

export const MAX_RECOVERY_CHECKPOINT_BYTES = 192 * 1024;
export const getRecoveryCheckpointSidecarSchema = defineSchema((v) =>
  v.object({
    snapshot_event_index: v.number().int().min(0).max(99),
    pending_model_turn_message_ids: v.array(v.string().min(1).max(256)).max(100).refine(
      (ids) => new Set(ids).size === ids.length,
      "Pending model message identities must be unique",
    ),
    snapshot: getRecoverySnapshotSchema().omit({
      acknowledgedEventId: true,
      acknowledgedExternalSequence: true,
      modelTurns: true,
    }).extend({
      runtimeContinuation: getRecoveryContinuationSchema(),
      modelTurns: v.array(
        getRecoveryModelTurnSchema().omit({ acknowledgedExternalSequence: true }).extend({
          acknowledgedExternalSequence: v.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
            .optional(),
        }),
      ).max(100),
    }).strict(),
  }).strict()
);
export type RecoveryCheckpointSidecar = InferSchema<
  ReturnType<typeof getRecoveryCheckpointSidecarSchema>
>;
export type RecoveryCheckpointAcknowledgement = {
  snapshot_event_id: number;
  snapshot_external_sequence: number;
  checkpoint_event_id: number;
};
