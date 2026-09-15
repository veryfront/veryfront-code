/**
 * Proof that a remote control request was authorized for one exact run.
 *
 * Remote cancel and resume reach the same run registry the runtime uses, keyed
 * by run id alone. Authenticating the caller does not establish permission to
 * control a particular run, so the effect must not be reachable from a run id
 * on its own. A gate placed at one route only protects that route: the next
 * surface that resolves a run id (the managed broker's cancel and resume
 * routes) has to remember to repeat it, and nothing fails when it does not.
 *
 * The session manager therefore accepts a run control authority instead of a
 * run id for those two effects. An authority can only be produced here, only
 * after a verifier answered for that exact run and operation, and the run id
 * the effect uses is read back out of the authority rather than supplied
 * separately, so a verified authority cannot be aimed at a different run.
 */

const authorities = new WeakSet<RunControlAuthorityRecord>();

/** Remote run control operations that require verified authority over the run. */
export type RunControlOperation = "cancel" | "resume";

type RunControlAuthorityRecord = {
  readonly runId: string;
  readonly operation: RunControlOperation;
};

declare const runControlAuthorityBrand: unique symbol;

/**
 * Verified permission to perform one control operation on one run.
 *
 * The brand is declared, never exported, and never assigned, so the type cannot
 * be produced outside this module. `assertRunControlAuthority` re-checks the
 * value at runtime, so a structural cast does not become authority either.
 */
export type VerifiedRunControlAuthority = RunControlAuthorityRecord & {
  readonly [runControlAuthorityBrand]: true;
};

/** Error shape for run control authority. */
export class RunControlAuthorityError extends Error {
  constructor(message = "Run control requires verified authority for this run") {
    super(message);
    this.name = "RunControlAuthorityError";
  }
}

/** Decide whether a caller may control this exact run, then mint the authority. */
export type RunControlAuthorizer = (
  input: { request: Request; runId: string; operation: RunControlOperation },
) => boolean | Promise<boolean>;

function grantRunControlAuthority(
  runId: string,
  operation: RunControlOperation,
): VerifiedRunControlAuthority {
  const authority = Object.freeze({ runId, operation });
  authorities.add(authority);
  return authority as VerifiedRunControlAuthority;
}

/**
 * Run the authorizer for this run and operation and mint authority only on a
 * literal `true`. A verifier that throws, resolves to a non-boolean, or is
 * missing denies the operation.
 */
export async function authorizeRunControl(
  authorize: RunControlAuthorizer | undefined,
  input: { request: Request; runId: string; operation: RunControlOperation },
): Promise<VerifiedRunControlAuthority | null> {
  if (typeof authorize !== "function") return null;
  if (typeof input.runId !== "string" || !input.runId) return null;
  let decision: unknown;
  try {
    decision = await authorize({
      request: input.request,
      runId: input.runId,
      operation: input.operation,
    });
  } catch {
    return null;
  }
  if (decision !== true) return null;
  return grantRunControlAuthority(input.runId, input.operation);
}

/**
 * Read the run id out of a genuine authority for the expected operation.
 *
 * Throws rather than returning a falsy value: an authority that did not come
 * from `authorizeRunControl` is a programming error at a security boundary,
 * and a silent no-op would read as a cancelled run to the caller.
 */
export function assertRunControlAuthority(
  authority: VerifiedRunControlAuthority,
  operation: RunControlOperation,
): string {
  if (!authority || typeof authority !== "object" || !authorities.has(authority)) {
    throw new RunControlAuthorityError();
  }
  if (authority.operation !== operation) {
    throw new RunControlAuthorityError(
      `Run control authority for "${authority.operation}" cannot perform "${operation}"`,
    );
  }
  if (typeof authority.runId !== "string" || !authority.runId) {
    throw new RunControlAuthorityError();
  }
  return authority.runId;
}
