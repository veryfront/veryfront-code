/**
 * Source-release binding for the framework-owned knowledge capability.
 *
 * A run whose agent source is another project's release executes in a
 * different project. Its runtime identity belongs to that execution project,
 * so the knowledge tool would otherwise read the execution project's files.
 * This binding points only the framework knowledge tool back at the agent's
 * pinned source release, using the source-read credential the control plane
 * minted for that run. Project-authored tools never receive it.
 *
 * @module knowledge/hosted-source-scope
 * @internal
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";

/** The pinned source release and its run-bound read credential. */
export interface HostedKnowledgeSourceScope {
  readonly projectId: string;
  readonly projectSlug: string;
  readonly releaseId: string;
  readonly authToken: string;
}

const sourceScopeStorage = new AsyncLocalStorage<Readonly<HostedKnowledgeSourceScope>>();
const frameworkKnowledgeOptions = createPrivateWeakStore<object, true>();
const apply = Reflect.apply;
const freeze = Object.freeze;
const run = AsyncLocalStorage.prototype.run;
const getStore = AsyncLocalStorage.prototype.getStore;

/** Run `fn` with the source release that framework knowledge reads. */
export function runWithHostedKnowledgeSource<T>(
  scope: HostedKnowledgeSourceScope,
  fn: () => T,
): T {
  return apply(run, sourceScopeStorage, [
    freeze({
      projectId: scope.projectId,
      projectSlug: scope.projectSlug,
      releaseId: scope.releaseId,
      authToken: scope.authToken,
    }),
    fn,
  ]) as T;
}

/** The bound source release, if this run reads knowledge from one. */
export function getHostedKnowledgeSource(): Readonly<HostedKnowledgeSourceScope> | undefined {
  return apply(getStore, sourceScopeStorage, []) as
    | Readonly<HostedKnowledgeSourceScope>
    | undefined;
}

/** Mark tool options as framework-owned, so the tool may use the source binding. */
export function markFrameworkKnowledgeOptions<T extends object>(options: T): T {
  frameworkKnowledgeOptions.set(options, true);
  return options;
}

/** Whether these tool options came from the framework, not project code. */
export function isFrameworkKnowledgeOptions(options: object): boolean {
  return frameworkKnowledgeOptions.get(options) === true;
}
