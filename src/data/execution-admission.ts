import { SERVICE_OVERLOADED } from "#veryfront/errors";
import {
  DATA_FETCHING_MAX_CONCURRENT_EXECUTIONS,
  DATA_FETCHING_MAX_CONCURRENT_EXECUTIONS_PER_PROJECT,
} from "#veryfront/utils/constants/cache.ts";
import { requireDataProjectId } from "./project-identity.ts";

export interface DataExecutionAdmissionOptions {
  maxConcurrent?: number;
  maxConcurrentPerProject?: number;
}

export interface DataExecutionAdmissionSnapshot {
  active: number;
  activeForProject: number;
}

function requirePositiveSafeInteger(
  value: number,
  option: string,
): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${option} must be a positive safe integer`);
  }
  return value;
}

/**
 * Fail-fast process admission for project data hooks.
 *
 * Callers receive an idempotent release function. The owner must retain that
 * lease until project code, worker protocol, validation, and publication have
 * settled—not merely until the HTTP caller disconnects.
 */
export class DataExecutionAdmission {
  private active = 0;
  private readonly activeByProject = new Map<string, number>();
  private readonly maxConcurrent: number;
  private readonly maxConcurrentPerProject: number;

  constructor(options: DataExecutionAdmissionOptions = {}) {
    this.maxConcurrent = requirePositiveSafeInteger(
      options.maxConcurrent ??
        DATA_FETCHING_MAX_CONCURRENT_EXECUTIONS,
      "maxConcurrent",
    );
    this.maxConcurrentPerProject = requirePositiveSafeInteger(
      options.maxConcurrentPerProject ??
        DATA_FETCHING_MAX_CONCURRENT_EXECUTIONS_PER_PROJECT,
      "maxConcurrentPerProject",
    );
    if (this.maxConcurrentPerProject > this.maxConcurrent) {
      throw new RangeError(
        "maxConcurrentPerProject must not exceed maxConcurrent",
      );
    }
  }

  acquire(projectId: string): () => void {
    const identity = requireDataProjectId(projectId);
    const activeForProject = this.activeByProject.get(identity) ?? 0;
    if (activeForProject >= this.maxConcurrentPerProject) {
      throw SERVICE_OVERLOADED.create({
        detail:
          `Project data execution capacity is exhausted (${activeForProject}/${this.maxConcurrentPerProject} active)`,
      });
    }
    if (this.active >= this.maxConcurrent) {
      throw SERVICE_OVERLOADED.create({
        detail:
          `Global data execution capacity is exhausted (${this.active}/${this.maxConcurrent} active)`,
      });
    }

    this.active++;
    this.activeByProject.set(identity, activeForProject + 1);
    let released = false;
    return (): void => {
      if (released) return;
      released = true;
      this.active--;
      const current = this.activeByProject.get(identity) ?? 0;
      if (current <= 1) {
        this.activeByProject.delete(identity);
      } else {
        this.activeByProject.set(identity, current - 1);
      }
    };
  }

  snapshot(projectId: string): DataExecutionAdmissionSnapshot {
    const identity = requireDataProjectId(projectId);
    return {
      active: this.active,
      activeForProject: this.activeByProject.get(identity) ?? 0,
    };
  }
}

/** Shared process budget used by direct fetcher construction. */
export const defaultDataExecutionAdmission = new DataExecutionAdmission();
