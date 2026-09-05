import { AsyncLocalStorage } from "node:async_hooks";

interface TurnFrame {
  runtime: object;
  parent?: TurnFrame;
  active: boolean;
  children: Set<TurnFrame>;
  waitingOn?: TurnFrame;
  next?: TurnFrame;
}

const storage = new AsyncLocalStorage<TurnFrame>();
const run = AsyncLocalStorage.prototype.run;
const getStore = AsyncLocalStorage.prototype.getStore;
const apply = Reflect.apply;
const queueTails = new WeakMap<object, TurnFrame>();

/** Preserve call ancestry across delegated generate and stream operations. */
export function withRuntimeTurnLineage<T>(runtime: object, operation: () => T): T {
  const parent = apply(getStore, storage, []) as TurnFrame | undefined;
  return apply(run, storage, [
    { runtime, parent, active: false, children: new Set<TurnFrame>() },
    operation,
  ]) as T;
}

function reaches(frame: TurnFrame, target: TurnFrame): boolean {
  const pending = [frame];
  const seen = new Set<TurnFrame>();
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (!current.active || seen.has(current)) continue;
    if (current === target) return true;
    seen.add(current);
    if (current.waitingOn) pending.push(current.waitingOn);
    for (const child of current.children) pending.push(child);
  }
  return false;
}

/** Reject queue waits on an unfinished ancestor; independent calls still queue. */
export function enterSerializedTurn(runtime: object): () => void {
  const frame = apply(getStore, storage, []) as TurnFrame | undefined;
  if (!frame || frame.runtime !== runtime) return () => {};
  let parent = frame.parent;
  while (parent && !parent.active) parent = parent.parent;
  const previous = queueTails.get(runtime);
  // Also follow existing queue dependencies: independently started roots can
  // deadlock when each delegates to the other's occupied runtime.
  if (parent && previous && reaches(previous, parent)) {
    throw new Error(
      "Stateful delegation cannot wait on an active ancestor or cyclic queue. Use an acyclic delegate graph.",
    );
  }
  frame.active = true;
  frame.waitingOn = previous;
  if (previous) previous.next = frame;
  parent?.children.add(frame);
  queueTails.set(runtime, frame);
  return () => {
    if (!frame.active) return;
    frame.active = false;
    parent?.children.delete(frame);
    if (frame.waitingOn) frame.waitingOn.next = frame.next;
    if (frame.next) frame.next.waitingOn = frame.waitingOn;
    if (queueTails.get(runtime) === frame) {
      if (frame.waitingOn) queueTails.set(runtime, frame.waitingOn);
      else queueTails.delete(runtime);
    }
    frame.waitingOn = undefined;
    frame.next = undefined;
  };
}
