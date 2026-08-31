import { runWithVeryfrontCloudInferenceCredential } from "#veryfront/provider/veryfront-cloud/provider.ts";

const inferenceCredentials = new WeakMap<object, string>();
const IntrinsicReflectApply = Reflect.apply;
const WeakMapGet = WeakMap.prototype.get;
const WeakMapSet = WeakMap.prototype.set;

/** @internal Bind a verified control-plane inference credential without exposing it on the request. */
export function registerHostedInferenceCredential(
  request: object,
  credential: string | undefined,
): void {
  if (!credential) return;
  IntrinsicReflectApply(WeakMapSet, inferenceCredentials, [request, credential]);
}

/** @internal Run hosted setup or execution with its private gateway credential. */
export function runWithHostedInferenceCredential<T>(request: object, operation: () => T): T {
  const storedCredential: unknown = IntrinsicReflectApply(
    WeakMapGet,
    inferenceCredentials,
    [request],
  );
  const credential = typeof storedCredential === "string" ? storedCredential : undefined;
  return runWithVeryfrontCloudInferenceCredential(credential, operation);
}
