import type { WorkAcceptanceCriterion, WorkConfig, WorkDefinition } from "./types.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";

/** Create a typed Work definition. */
export function work(config: WorkConfig): WorkDefinition {
  const id = assertWorkId(config.id);
  const outcome = assertNonEmptyString(config.outcome, `Work "${id}" outcome`);

  if (!Array.isArray(config.acceptanceCriteria) || config.acceptanceCriteria.length === 0) {
    throwWorkConfigError(`Work "${id}" must define at least one acceptance criterion.`);
  }

  const seenCriterionIds = new Set<string>();
  const acceptanceCriteria = config.acceptanceCriteria.map((criterion, index) => {
    const criterionId = assertNonEmptyString(
      criterion.id,
      `Work "${id}" acceptance criterion at index ${index} id`,
    );
    if (seenCriterionIds.has(criterionId)) {
      throwWorkConfigError(
        `Work "${id}" has duplicate acceptance criterion id "${criterionId}".`,
      );
    }
    seenCriterionIds.add(criterionId);

    const description = assertNonEmptyString(
      criterion.description,
      `Work "${id}" acceptance criterion "${criterionId}" description`,
    );

    const normalizedCriterion: WorkAcceptanceCriterion = {
      id: criterionId,
      description,
    };
    if (criterion.optional === true) {
      normalizedCriterion.optional = true;
    }
    return normalizedCriterion;
  });

  return {
    id,
    name: config.name?.trim() || id,
    outcome,
    acceptanceCriteria,
  };
}

function assertWorkId(value: string): string {
  const id = assertNonEmptyString(value, "Work id");
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) {
    throwWorkConfigError(
      "Work id must be a path-safe single segment using letters, numbers, underscores, or hyphens.",
    );
  }
  return id;
}

function assertNonEmptyString(value: string, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throwWorkConfigError(`${label} cannot be empty.`);
  }
  return value.trim();
}

function throwWorkConfigError(message: string): never {
  throw toError(
    createError({
      type: "agent",
      message,
    }),
  );
}
