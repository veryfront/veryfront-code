import { createPrivateSet } from "./private-set.ts";
import { defineOwnDataProperty } from "./own-data-property.ts";

const any = AbortSignal.any;
const apply = Reflect.apply;
const iterator = Symbol.iterator;

/** Join host lifetimes without consulting project-replaceable static or iterator methods. */
export function joinPrivateAbortSignals(first: AbortSignal, second: AbortSignal): AbortSignal {
  const signals = [first, second];
  const captured = createPrivateSet(signals);
  defineOwnDataProperty(signals, iterator, () => captured.values());
  return apply(any, AbortSignal, [signals]) as AbortSignal;
}
