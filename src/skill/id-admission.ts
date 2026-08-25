/** Shared fail-closed admission for canonical skill IDs. */

export type SkillIdClaim = Readonly<{
  id: string;
  source: string;
  ownerAgentId?: string;
}>;

export class SkillIdCollisionError extends Error {
  readonly id: string;
  readonly existing: SkillIdClaim;
  readonly incoming: SkillIdClaim;

  constructor(existing: SkillIdClaim, incoming: SkillIdClaim) {
    super(
      `Ambiguous skill id "${incoming.id}": ${incoming.source} conflicts with ${existing.source}; neither definition is admitted.`,
    );
    this.name = "SkillIdCollisionError";
    this.id = incoming.id;
    this.existing = existing;
    this.incoming = incoming;
  }
}

export type SkillIdAdmissionResult =
  | { accepted: true }
  | { accepted: false; error: SkillIdCollisionError };

/**
 * Tracks canonical definitions after format/root precedence has been resolved.
 * The second claim poisons the ID, so later claims cannot resurrect either
 * definition through ordering differences.
 */
export class SkillIdAdmission {
  readonly #accepted = new Map<string, SkillIdClaim>();
  readonly #rejected = new Map<string, SkillIdClaim>();

  claim(value: SkillIdClaim): SkillIdAdmissionResult {
    if (!value || typeof value.id !== "string" || value.id.length === 0) {
      throw new TypeError("Skill ID admission requires a non-empty id");
    }
    if (typeof value.source !== "string" || value.source.length === 0) {
      throw new TypeError("Skill ID admission requires a source label");
    }
    const claim = Object.freeze({ ...value });
    const rejected = this.#rejected.get(claim.id);
    if (rejected) {
      return {
        accepted: false,
        error: new SkillIdCollisionError(rejected, claim),
      };
    }
    const existing = this.#accepted.get(claim.id);
    if (existing) {
      this.#accepted.delete(claim.id);
      this.#rejected.set(claim.id, existing);
      return {
        accepted: false,
        error: new SkillIdCollisionError(existing, claim),
      };
    }
    this.#accepted.set(claim.id, claim);
    return { accepted: true };
  }

  hasClaim(id: string): boolean {
    return this.#accepted.has(id) || this.#rejected.has(id);
  }

  isRejected(id: string): boolean {
    return this.#rejected.has(id);
  }
}

const objectScopedAdmissions = new WeakMap<object, SkillIdAdmission>();

/** Reuse one admission ledger across a staged discovery result. */
export function getObjectScopedSkillIdAdmission(owner: object): SkillIdAdmission {
  let admission = objectScopedAdmissions.get(owner);
  if (!admission) {
    admission = new SkillIdAdmission();
    objectScopedAdmissions.set(owner, admission);
  }
  return admission;
}
