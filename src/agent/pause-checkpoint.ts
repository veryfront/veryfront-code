/**
 * Native completed-step checkpoints for control-plane consumers.
 * Configure a SchemaValidator before parsing, as for other Veryfront schemas.
 * @module agent/pause-checkpoint
 */
export {
  type AgentPauseCheckpoint,
  getAgentPauseCheckpointSchema,
  parseAgentPauseCheckpoint,
} from "./runtime/manual-pause.ts";
