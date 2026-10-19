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

const credentialStorage = createPrivateAsyncLocalStorage<CredentialAuthority>();
const run = credentialStorage.run;
const getStore = credentialStorage.getStore;
const apply = Reflect.apply;
const freeze = Object.freeze;

/** @internal Bind a host-verified exact-run credential around trusted skill execution. */
export function runWithVerifiedSkillScriptExecutionCredential<T>(
  authority: CredentialAuthority,
  operation: () => T,
): T {
  authority.assertActive();
  return apply(run, credentialStorage, [authority, operation]) as T;
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
