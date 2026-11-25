/**
 * Source-release binding for the framework-owned knowledge capability.
 *
 * A run whose agent source is another project's release executes in a
 * different project. Its runtime identity belongs to that execution project,
 * so the knowledge tool would otherwise read the execution project's files.
 * This binding points only the framework knowledge tool back at the agent's
 * pinned source release.
 *
 * The binding carries no credential: the host builds its file lister around
 * the run's source-read credential. The binding's reader and the
 * framework-ownership marker are each handed out once, to the framework
 * modules that claim them when they load, and the signed knowledge selector
 * caps whatever the binding returns.
 *
 * @module knowledge/hosted-source-scope
 * @internal
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";
import type { CreateSearchKnowledgeToolOptions, ProjectKnowledgeScopeSelector } from "./index.ts";

/** One file of the pinned source release's knowledge folder. */
export interface SourceReleaseKnowledgeFile {
  readonly path: string;
  readonly content?: unknown;
}

/** The pinned source release a shared agent's knowledge is read from. */
export interface HostedKnowledgeSourceScope {
  readonly releaseId: string;
  /** The signed agent's knowledge selector; reads never exceed it. */
  readonly knowledge: ProjectKnowledgeScopeSelector;
  /** Lists the release's knowledge folder; the host binds its credential. */
  readonly listKnowledgeFiles: () => Promise<readonly SourceReleaseKnowledgeFile[]>;
}

type MarkFrameworkKnowledgeOptions = <T extends CreateSearchKnowledgeToolOptions>(options: T) => T;
type ReadHostedKnowledgeSource = () => Readonly<HostedKnowledgeSourceScope> | undefined;

const sourceScopeStorage = new AsyncLocalStorage<Readonly<HostedKnowledgeSourceScope>>();
const frameworkKnowledgeOptions = createPrivateWeakStore<CreateSearchKnowledgeToolOptions, true>();
const apply = Reflect.apply;
const freeze = Object.freeze;
const run = AsyncLocalStorage.prototype.run;
const getStore = AsyncLocalStorage.prototype.getStore;
let readerClaimed = false;
let markerClaimed = false;

/** Run `fn` with the source release that framework knowledge reads. */
export function runWithHostedKnowledgeSource<T>(
  scope: HostedKnowledgeSourceScope,
  fn: () => T,
): T {
  return apply(run, sourceScopeStorage, [
    freeze({
      releaseId: scope.releaseId,
      knowledge: scope.knowledge,
      listKnowledgeFiles: scope.listKnowledgeFiles,
    }),
    fn,
  ]) as T;
}

/** Hand the bound-source reader to the knowledge module, once. */
export function claimHostedKnowledgeSourceReader(): ReadHostedKnowledgeSource {
  if (readerClaimed) throw new Error("The hosted knowledge source reader is already claimed");
  readerClaimed = true;
  return () =>
    apply(getStore, sourceScopeStorage, []) as Readonly<HostedKnowledgeSourceScope> | undefined;
}

/** Hand the framework-ownership marker to the framework knowledge tool factory, once. */
export function claimFrameworkKnowledgeMarker(): MarkFrameworkKnowledgeOptions {
  if (markerClaimed) throw new Error("The framework knowledge marker is already claimed");
  markerClaimed = true;
  return (options) => {
    frameworkKnowledgeOptions.set(options, true);
    return options;
  };
}

/** Whether these tool options came from the framework, not project code. */
export function isFrameworkKnowledgeOptions(options: CreateSearchKnowledgeToolOptions): boolean {
  return frameworkKnowledgeOptions.get(options) === true;
}
