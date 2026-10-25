/**
 * Private WeakMap-backed storage for stream protocol classifications.
 *
 * When a provider stream parser detects a protocol violation, it records the
 * fixed classification here before throwing. Telemetry reads only from this
 * trusted store, so forged error fields cannot inject arbitrary text into logs.
 */

const apply = Reflect.apply;
const weakMapGet = WeakMap.prototype.get;
const weakMapSet = WeakMap.prototype.set;
const classifications = new WeakMap<object, string>();

/** Record a stream protocol classification on the error that created it. */
export function recordStreamProtocolClassification(
  error: Error,
  classification: string,
): void {
  apply(weakMapSet, classifications, [error, classification]);
}

/** Read the trusted stream protocol classification, if any. */
export function readStreamProtocolClassification(
  error: unknown,
): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  return apply(weakMapGet, classifications, [error]) as string | undefined;
}
