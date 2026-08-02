/**
 * Cross-context lock support for the local conversation store.
 *
 * Web Storage has no transaction spanning a conversation blob and its shared
 * index. Every operation therefore acquires one Web Lock for the whole logical
 * store. The lock name deliberately excludes the persisted format version so a
 * future migration still coordinates with the current writer.
 *
 * @module react/components/chat/persistence/conversation-store-lock
 */

/** @internal Lock capability injected into local-store contract tests. */
export interface ConversationStoreLockRunner {
  run<T>(
    name: string,
    criticalSection: () => T | PromiseLike<T>,
  ): Promise<T>;
}

/** @internal Minimal Web Locks surface used by the adapter. */
export interface WebLockManagerLike {
  request<T>(
    name: string,
    options: { mode: "exclusive" },
    callback: () => T | PromiseLike<T>,
  ): Promise<T>;
}

/** @internal Stable lock identity for one logical local conversation store. */
export function conversationStoreLockName(storageKey: string): string {
  return `veryfront:chat:conversation-storage:${JSON.stringify(storageKey)}`;
}

function getWebLockManager(): Partial<WebLockManagerLike> | undefined {
  return (globalThis as {
    navigator?: { locks?: Partial<WebLockManagerLike> };
  }).navigator?.locks;
}

/**
 * @internal Build a fail-closed runner. The getter seam keeps tests independent
 * of the host process's global navigator.
 */
export function createBrowserConversationStoreLockRunner(
  readLocks: () => Partial<WebLockManagerLike> | undefined = getWebLockManager,
): ConversationStoreLockRunner {
  return {
    async run<T>(
      name: string,
      criticalSection: () => T | PromiseLike<T>,
    ): Promise<T> {
      let locks: Partial<WebLockManagerLike> | undefined;
      try {
        locks = readLocks();
      } catch (cause) {
        throw new Error(
          "The local conversation store could not access the Web Locks API",
          { cause },
        );
      }
      if (!locks || typeof locks.request !== "function") {
        throw new Error(
          "The local conversation store requires the Web Locks API in a secure browser context",
        );
      }
      return await locks.request(name, { mode: "exclusive" }, criticalSection);
    },
  };
}

/*
 * Keep one runner object so every local store uses the same feature-detection
 * path. Web Locks itself owns cross-context queuing.
 */
export const browserConversationStoreLockRunner: ConversationStoreLockRunner =
  createBrowserConversationStoreLockRunner();
