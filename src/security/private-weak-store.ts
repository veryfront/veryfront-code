type PrivateWeakStore<TKey extends object, TValue> = Readonly<{
  get(key: TKey): TValue | undefined;
  set(key: TKey, value: TValue): void;
}>;

const IntrinsicReflectApply = Reflect.apply;
const WeakMapGet = WeakMap.prototype.get;
const WeakMapSet = WeakMap.prototype.set;

/** Create an internal WeakMap facade with non-replaceable operations. */
export function createPrivateWeakStore<TKey extends object, TValue>(): PrivateWeakStore<
  TKey,
  TValue
> {
  const store = new WeakMap<TKey, TValue>();
  return Object.freeze({
    get(key: TKey): TValue | undefined {
      return IntrinsicReflectApply(WeakMapGet, store, [key]) as TValue | undefined;
    },
    set(key: TKey, value: TValue): void {
      IntrinsicReflectApply(WeakMapSet, store, [key, value]);
    },
  });
}
