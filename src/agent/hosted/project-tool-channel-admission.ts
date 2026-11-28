import { EXECUTOR_MAX_CONCURRENT_CALLS } from "#veryfront/agent/executor/protocol.ts";
import type { ExecutorChannel } from "#veryfront/agent/executor/channel.ts";
import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";
import { createPrivateMap } from "#veryfront/security/private-map.ts";
import {
  createPrivateDeferred,
  observePrivatePromise,
} from "#veryfront/security/private-promise.ts";

const admissions = createPrivateWeakStore<ExecutorChannel, ReturnType<typeof createAdmission>>();
const floor = Math.floor;
const isSafeInteger = Number.isSafeInteger;

function createAdmission(capacity: number) {
  if (!isSafeInteger(capacity) || capacity < 1 || capacity > EXECUTOR_MAX_CONCURRENT_CALLS) {
    throw new TypeError("Invalid project channel capacity");
  }
  // Each admitted tool can hold its execution stream and approval watcher. Leave control headroom.
  const limit = capacity < 4 ? 1 : floor((capacity - 2) / 2);
  const waiting = createPrivateMap<number, { grant(): void }>();
  let active = 0, sequence = 0;
  const lease = () => {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      active--;
      const next = waiting.entries().next();
      if (!next.done) {
        waiting.delete(next.value[0]);
        next.value[1].grant();
      }
    };
  };
  return {
    supportsApproval: capacity >= 2,
    async acquire(signal: AbortSignal): Promise<() => void> {
      signal.throwIfAborted();
      if (active < limit) {
        active++;
        return lease();
      }
      if (waiting.size >= EXECUTOR_MAX_CONCURRENT_CALLS * 2) {
        throw new TypeError("Project channel admission queue is full");
      }
      const id = ++sequence;
      const ready = createPrivateDeferred<() => void>();
      const abort = () => {
        if (waiting.delete(id)) ready.reject(new TypeError("Project channel admission cancelled"));
        signal.removeEventListener("abort", abort);
      };
      waiting.set(id, {
        grant() {
          signal.removeEventListener("abort", abort);
          active++;
          ready.resolve(lease());
        },
      });
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      const release = await observePrivatePromise(ready.promise);
      try {
        signal.throwIfAborted();
      } catch (error) {
        release();
        throw error;
      }
      return release;
    },
  };
}

/** One bounded queue per physical channel, shared by every project-tool source on it. */
export function projectToolChannelAdmission(channel: ExecutorChannel) {
  let admission = admissions.get(channel);
  if (!admission) {
    admission = createAdmission(channel.maxConcurrentCalls ?? EXECUTOR_MAX_CONCURRENT_CALLS);
    admissions.set(channel, admission);
  }
  return admission;
}
