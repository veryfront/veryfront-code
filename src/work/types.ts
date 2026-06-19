/** One measurable expectation for a Work definition. */
export interface WorkExpectation {
  /** Stable identifier used by execution state and cloud persistence. */
  id: string;
  /** Human-readable condition that must be satisfied unless optional. */
  description: string;
  /** Optional expectations do not block Work execution completion. */
  optional?: true;
}

/**
 * Deprecated alias for WorkExpectation.
 *
 * @deprecated Use WorkExpectation.
 */
export type WorkAcceptanceCriterion = WorkExpectation;

/** Configuration used by work(). */
export interface WorkConfig {
  /** Stable project-local Work identifier. */
  id: string;
  /** Human-readable display name. Defaults to the id when omitted. */
  name?: string;
  /** Business outcome the execution layer should make true. */
  outcome: string;
  /** Expectations tracked as business process state. */
  expectations?: WorkExpectation[];
  /** @deprecated Use expectations. */
  acceptanceCriteria?: WorkExpectation[];
}

/** Public API contract for Work definitions. */
export interface WorkDefinition {
  id: string;
  name: string;
  outcome: string;
  expectations: WorkExpectation[];
  /** @deprecated Use expectations. */
  acceptanceCriteria: WorkExpectation[];
}

/** Agent-level reference to source-declared Work. */
export type WorkReference = string | WorkDefinition;
