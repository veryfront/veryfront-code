import { chainPrivatePromise } from "#veryfront/security/private-promise.ts";
import { createPrivateAsyncLocalStorage } from "#veryfront/security/private-async-context.ts";

export interface VerifiedSkillScriptExecutionCredential {
  readonly apiUrl: string;
  readonly authToken: string;
  readonly projectId: string;
  readonly projectSlug?: string;
  readonly branch?: string | null;
  readonly runId: string;
  readonly agentId: string;
}

type CredentialAuthority = Readonly<{
  read(): VerifiedSkillScriptExecutionCredential;
  assertActive(): void;
}>;

type ScopedCredentialAuthority = CredentialAuthority & {
  retain(completion: Promise<void>): void;
};

const credentialStorage = createPrivateAsyncLocalStorage<ScopedCredentialAuthority>();
const run = credentialStorage.run;
const getStore = credentialStorage.getStore;
const apply = Reflect.apply;
const freeze = Object.freeze;

/** @internal Bind a host-verified exact-run credential around trusted skill execution. */
export async function runWithVerifiedSkillScriptExecutionCredential<T>(
  authority: CredentialAuthority,
  operation: () => Promise<T>,
): Promise<T> {
  authority.assertActive();
  let active = true;
  let operationSettled = false;
  let pendingProducers = 0;
  const revokeWhenSettled = () => {
    if (operationSettled && pendingProducers === 0) active = false;
  };
  const scopedAuthority: ScopedCredentialAuthority = freeze({
    retain(completion) {
      if (operationSettled) {
        throw new TypeError("Skill script execution credential setup has ended");
      }
      if (!active) throw new TypeError("Skill script execution credential is no longer active");
      authority.assertActive();
      pendingProducers++;
      const settle = () => {
        pendingProducers--;
        revokeWhenSettled();
      };
      void chainPrivatePromise(completion, settle, settle);
    },
    assertActive() {
      if (!active) throw new TypeError("Skill script execution credential is no longer active");
      authority.assertActive();
    },
    read() {
      if (!active) throw new TypeError("Skill script execution credential is no longer active");
      authority.assertActive();
      return authority.read();
    },
  });
  try {
    return await (apply(run, credentialStorage, [scopedAuthority, operation]) as Promise<T>);
  } finally {
    operationSettled = true;
    revokeWhenSettled();
  }
}

/** @internal Read the active credential only after its host authority remains live. */
export function getVerifiedSkillScriptExecutionCredential():
  | VerifiedSkillScriptExecutionCredential
  | undefined {
  const authority = apply(getStore, credentialStorage, []) as CredentialAuthority | undefined;
  if (!authority) return undefined;
  authority.assertActive();
  return freeze({ ...authority.read() });
}

/** @internal Retain the current credential until an actual runtime producer settles. */
export function retainVerifiedSkillScriptExecutionCredentialUntil(completion: Promise<void>): void {
  const authority = apply(getStore, credentialStorage, []) as ScopedCredentialAuthority | undefined;
  authority?.retain(completion);
}
