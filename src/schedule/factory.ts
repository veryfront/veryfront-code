import type { AgentScheduleConfig, ScheduleConfig, ScheduleDefinition } from "./types.ts";
import { normalizeScheduleConfig } from "./validation.ts";

/**
 * Validate and normalize a source-defined schedule configuration.
 *
 * The schedule uses a bounded five-field POSIX cron expression. Month and
 * weekday names are accepted, timezones must be recognized IANA names, and
 * the `cron` alias is converted to the canonical `schedule` field. Invalid
 * top-level or nested fields fail with `schedule-config-invalid`.
 *
 * An agent target carries its own `conversationMode` and `conversationId`, and
 * `agentMessage.prompt` supplies the prompt. Both are rejected for task and
 * workflow targets.
 */
export function schedule(config: AgentScheduleConfig): ScheduleDefinition;
export function schedule(
  config: ScheduleConfig & { agentMessage?: never },
): ScheduleDefinition;
export function schedule(
  config: AgentScheduleConfig | ScheduleConfig,
): ScheduleDefinition {
  return normalizeScheduleConfig(config);
}
