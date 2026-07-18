import { SCHEDULE_CONFIG_INVALID } from "#veryfront/errors";
import { isTriggerTarget } from "#veryfront/trigger/target.ts";
import { assertSerializable, validateTriggerId } from "#veryfront/trigger/validation.ts";
import type { ScheduleConcurrencyPolicy, ScheduleConfig, ScheduleDefinition } from "./types.ts";

const CONCURRENCY_POLICIES = new Set<ScheduleConcurrencyPolicy>(["Allow", "Forbid", "Replace"]);

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw SCHEDULE_CONFIG_INVALID.create({ detail: `${label} is required.` });
  }
  return value;
}

function validatePositiveInteger(value: unknown, label: string): void {
  if (value === undefined) return;
  if (!Number.isInteger(value) || Number(value) <= 0) {
    throw SCHEDULE_CONFIG_INVALID.create({ detail: `${label} must be a positive integer.` });
  }
}

export function schedule(config: ScheduleConfig): ScheduleDefinition {
  const id = requireString(config.id, "Schedule id");
  validateTriggerId(id, "Schedule");

  const scheduleExpression = config.schedule ?? config.cron;
  const normalizedSchedule = requireString(scheduleExpression, "Schedule cron");

  if (!isTriggerTarget(config.target)) {
    throw SCHEDULE_CONFIG_INVALID.create({
      detail: "Schedule target must specify a valid task, workflow, or agent id.",
    });
  }

  if (
    config.concurrencyPolicy !== undefined &&
    !CONCURRENCY_POLICIES.has(config.concurrencyPolicy)
  ) {
    throw SCHEDULE_CONFIG_INVALID.create({
      detail: "Schedule concurrencyPolicy must be Allow, Forbid, or Replace.",
    });
  }

  validatePositiveInteger(config.timeoutSeconds, "Schedule timeoutSeconds");
  validatePositiveInteger(config.backoffLimit, "Schedule backoffLimit");
  validatePositiveInteger(config.maxRuns, "Schedule maxRuns");
  assertSerializable(config.input, "Schedule input");

  return {
    id,
    ...(config.name === undefined ? {} : { name: config.name }),
    ...(config.description === undefined ? {} : { description: config.description }),
    schedule: normalizedSchedule,
    ...(config.timezone === undefined ? {} : { timezone: config.timezone }),
    target: { kind: config.target.kind, id: config.target.id },
    ...(config.input === undefined ? {} : { input: config.input }),
    ...(config.timeoutSeconds === undefined ? {} : { timeoutSeconds: config.timeoutSeconds }),
    ...(config.backoffLimit === undefined ? {} : { backoffLimit: config.backoffLimit }),
    ...(config.concurrencyPolicy === undefined
      ? {}
      : { concurrencyPolicy: config.concurrencyPolicy }),
    ...(config.maxRuns === undefined ? {} : { maxRuns: config.maxRuns }),
  };
}
