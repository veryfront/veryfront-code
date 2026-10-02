const hasOwn = Object.hasOwn;

/** Dispatch own array entries in order; rejection stops subsequent side effects. */
export async function forEachSequential<T>(
  values: readonly T[],
  visit: (value: T) => Promise<void>,
): Promise<void> {
  const next = async (index: number): Promise<void> => {
    while (index < values.length && !hasOwn(values, index)) index++;
    if (index >= values.length) return;
    await visit(values[index]!);
    return next(index + 1);
  };
  return next(0);
}

/** Find the first matching own entry without starting later source discovery. */
export async function findSequential<T>(
  values: readonly T[],
  matches: (value: T) => Promise<boolean>,
): Promise<T | undefined> {
  const next = async (index: number): Promise<T | undefined> => {
    while (index < values.length && !hasOwn(values, index)) index++;
    if (index >= values.length) return undefined;
    const value = values[index]!;
    if (await matches(value)) return value;
    return next(index + 1);
  };
  return next(0);
}
