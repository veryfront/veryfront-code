const IntrinsicReflectApply = Reflect.apply;
const ObjectCreate = Object.create;
const ObjectKeys = Object.keys;

/** Keep delegated application credentials while omitting host-private invocation authority. */
export function withoutPrivateInvocationCredentials(
  credentials: Record<string, unknown>,
): Record<string, unknown> {
  const keys = IntrinsicReflectApply(ObjectKeys, Object, [credentials]) as string[];
  const retained = ObjectCreate(null) as Record<string, unknown>;
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!;
    if (key !== "inferenceAuthToken" && key !== "sourceAuthToken") {
      retained[key] = credentials[key];
    }
  }
  return retained;
}
