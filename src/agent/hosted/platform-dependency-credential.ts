import type { ParsedHostedChatRequest } from "./chat-request-parser.ts";
import type { ConversationRunProjection } from "../conversation/durable.ts";
import type { HostedInferenceAuthorityOwner } from "./inference-credential.ts";

export type HostedPlatformDependencyOwner =
  | ParsedHostedChatRequest
  | Pick<ConversationRunProjection, "runId">
  | { readonly childRunId: string };

import { appendPrivateArray } from "#veryfront/security/private-array.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";
import type { RemoteToolSource } from "#veryfront/tool/types.ts";
import {
  createVerifiedPlatformToolDependencyRunner,
  getVerifiedPlatformToolDependencies,
  hasVerifiedHostedPlatformDependencyWriter,
  type HostedServiceRunEventAppendTokenInput,
  type HostedServiceRunEventAppendTokenResult,
  type HostedServiceRunEventAppendTokenVerification,
  toRunEventAppendTokenResult,
} from "../service/auth.ts";

type Scope = Readonly<{ projectId: string; runId: string; agentId: string }>;
type Verifier = (
  input: HostedServiceRunEventAppendTokenInput,
) => Promise<HostedServiceRunEventAppendTokenVerification>;
type SourceFactory = (
  scope: Scope,
  authToken: string,
  owner: HostedPlatformDependencyOwner,
) => Promise<RemoteToolSource | undefined>;
type Runner = ReturnType<typeof createVerifiedPlatformToolDependencyRunner>;
type Authority = {
  scope: Scope;
  verify: Verifier;
  authToken: string;
  runner?: Runner;
  sourceFactory?: SourceFactory;
  active: boolean;
  children: Authority[];
};
const owners = createPrivateWeakStore<object, Authority>();
const runtimeOwners = createPrivateWeakStore<object, Authority>();
const execution = new AsyncLocalStorage<Authority>();
const Run = AsyncLocalStorage.prototype.run;
const Get = AsyncLocalStorage.prototype.getStore;
const Apply = Reflect.apply;
const Freeze = Object.freeze;

/** Retain ingress proof at its original private request identity, never in request JSON. */
export function registerHostedPlatformDependencyRequest(
  owner: HostedPlatformDependencyOwner,
  verification: HostedServiceRunEventAppendTokenResult,
  scope: Scope,
  verify: Verifier,
  authToken: string,
): void {
  if (!hasVerifiedHostedPlatformDependencyWriter(verification, scope)) return;
  const dependencies = getVerifiedPlatformToolDependencies(verification, scope);
  owners.set(owner, {
    scope: Freeze({ ...scope }),
    verify,
    authToken,
    ...(dependencies !== undefined
      ? { runner: createVerifiedPlatformToolDependencyRunner(verification, scope) }
      : {}),
    active: true,
    children: [],
  });
}

/** Configure transport only through the original host-owned parsed request. */
export async function configureHostedPlatformDependencySource(
  owner: HostedPlatformDependencyOwner,
  factory: SourceFactory,
): Promise<void> {
  const authority = owners.get(owner);
  if (!authority?.active) return;
  authority.sourceFactory = factory;
  if (authority.runner) {
    const source = await factory(authority.scope, authority.authToken, owner);
    if (source) authority.runner.captureSource(source);
  }
}

/** Verify the authenticated admission's exact child JWT; parent grants never become child grants. */
export async function registerHostedChildPlatformDependencies(
  parent: HostedPlatformDependencyOwner,
  child: HostedPlatformDependencyOwner,
  scope: Scope,
  eventToken: string,
  authToken: string,
): Promise<void> {
  const authority = owners.get(parent);
  if (!authority?.active) return;
  const verification = toRunEventAppendTokenResult(
    await authority.verify({ token: eventToken, ...scope }),
  );
  if (!authority.active) throw new Error("Hosted parent dependency authority is no longer active");
  if (!verification.verified) throw new Error("Inherited child writer verification failed");
  registerHostedPlatformDependencyRequest(child, verification, scope, authority.verify, authToken);
  const childAuthority = owners.get(child);
  if (!childAuthority) throw new Error("Inherited child writer provenance is unavailable");
  appendPrivateArray(authority.children, [childAuthority]);
  try {
    if (authority.sourceFactory) {
      await configureHostedPlatformDependencySource(child, authority.sourceFactory);
    }
    if (!authority.active || !childAuthority.active) {
      throw new Error("Hosted child dependency authority is no longer active");
    }
  } catch (error) {
    revokeAuthority(childAuthority);
    throw error;
  }
}

/** Transfer only the private admission descriptor association. */
export function transferHostedPlatformDependencies(
  source: HostedPlatformDependencyOwner,
  target: HostedPlatformDependencyOwner,
): void {
  const authority = owners.get(source);
  if (authority) owners.set(target, authority);
}

function runAuthority<T>(
  authority: Authority | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  if (!authority) return operation();
  if (!authority.active) {
    throw new Error("Hosted platform dependency authority is no longer active");
  }
  return Apply(Run, execution, [
    authority,
    () => authority.runner ? authority.runner.run(operation) : operation(),
  ]) as Promise<T>;
}

/** Enter preparation or actual execution using an original request/admission descriptor. */
export function runWithHostedPlatformDependencies<T>(
  owner: HostedPlatformDependencyOwner,
  operation: () => Promise<T>,
): Promise<T> {
  return runAuthority(owners.get(owner), operation);
}

/** Capture preparation's private authority for the runtime's later stream execution. */
export function captureHostedPlatformDependencyExecution() {
  const authority = Apply(Get, execution, []) as Authority | undefined;
  return <T>(operation: () => Promise<T>): Promise<T> => runAuthority(authority, operation);
}

function revokeAuthority(authority: Authority): void {
  authority.active = false;
  authority.runner?.revoke();
  for (let index = 0; index < authority.children.length; index++) {
    revokeAuthority(authority.children[index]!);
  }
}

export function revokeHostedPlatformDependencies(owner: HostedPlatformDependencyOwner): void {
  const authority = owners.get(owner);
  if (authority) revokeAuthority(authority);
}

/** Bind runtime identity only from a genuine admitted child descriptor. */
export function bindHostedPlatformDependencyRuntime(
  target: HostedInferenceAuthorityOwner,
  descriptor: HostedPlatformDependencyOwner,
): void {
  const authority = owners.get(descriptor);
  if (authority?.active && authority.runner) runtimeOwners.set(target, authority);
}

/** Preserve the private association across host-created fork runtime inputs. */
export function inheritHostedPlatformDependencyRuntime(
  target: HostedInferenceAuthorityOwner,
  source: HostedInferenceAuthorityOwner,
): void {
  const authority = runtimeOwners.get(source);
  if (authority) runtimeOwners.set(target, authority);
}

/** Runtime identity is data; the original runner remains the authority. */
export function hostedPlatformDependencyRuntimeContext(
  input: HostedInferenceAuthorityOwner,
  projectId: string | null,
): Scope | undefined {
  const authority = runtimeOwners.get(input);
  if (!authority) return undefined;
  if (!authority.active || authority.scope.projectId !== projectId) {
    throw new Error("Hosted platform dependency runtime binding mismatch");
  }
  return authority.scope;
}
