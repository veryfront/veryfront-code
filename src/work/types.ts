/** One measurable outcome condition for a Work definition. */
export interface WorkAcceptanceCriterion {
  /** Stable identifier used by execution state and cloud persistence. */
  id: string;
  /** Human-readable condition that must be satisfied unless optional. */
  description: string;
  /** Optional criteria do not block Work execution completion. */
  optional?: true;
}

/** Configuration used by work(). */
export interface WorkConfig {
  /** Stable project-local Work identifier. */
  id: string;
  /** Human-readable display name. Defaults to the id when omitted. */
  name?: string;
  /** Business outcome the execution layer should make true. */
  outcome: string;
  /** Outcome criteria tracked as business process state. */
  acceptanceCriteria: WorkAcceptanceCriterion[];
}

/** Public API contract for Work definitions. */
export interface WorkDefinition {
  id: string;
  name: string;
  outcome: string;
  acceptanceCriteria: WorkAcceptanceCriterion[];
}

/** Agent-level reference to source-declared Work. */
export type WorkReference = string | WorkDefinition;
