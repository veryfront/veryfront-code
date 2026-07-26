import { INVALID_ARGUMENT } from "#veryfront/errors";
import {
  isRepositoryIdentityComponent,
  MAX_REPOSITORY_IDENTITY_CODE_UNITS,
} from "./constraints.ts";
import type { RepositoryContext } from "./types.ts";

function validateIdentityComponent(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !isRepositoryIdentityComponent(value)
  ) {
    throw INVALID_ARGUMENT.create({
      detail:
        `${label} must be a trimmed, well-formed 1-${MAX_REPOSITORY_IDENTITY_CODE_UNITS} character string without control characters`,
    });
  }

  return value;
}

/**
 * Validate and snapshot the cache/filesystem identity carried by a repository.
 *
 * Repository contexts are value objects. Retaining the caller's mutable object
 * would allow a repository to move between tenant namespaces after creation.
 */
export function snapshotRepositoryContext(context: RepositoryContext): RepositoryContext {
  if (typeof context !== "object" || context === null) {
    throw INVALID_ARGUMENT.create({ detail: "Repository context must be an object" });
  }

  const input = context as unknown as Record<string, unknown>;
  const environment = input.environment;
  if (environment !== "preview" && environment !== "production") {
    throw INVALID_ARGUMENT.create({
      detail: 'Repository environment must be "preview" or "production"',
    });
  }

  return Object.freeze({
    projectId: validateIdentityComponent(input.projectId, "Repository projectId"),
    environment,
    versionId: validateIdentityComponent(input.versionId, "Repository versionId"),
  });
}
