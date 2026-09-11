const objectPrototype = Object.prototype;
const descriptor = Object.getOwnPropertyDescriptor;
const prototypeOf = Object.getPrototypeOf;

/** Reject known thenable inheritance before asynchronous authentication begins. */
export function isSafeHostedJwtVerificationEnvironment(input: unknown = objectPrototype): boolean {
  try {
    if (descriptor(objectPrototype, "then") !== undefined) return false;
    let current = input;
    for (let depth = 0; depth < 128; depth++) {
      if (current === null) return true;
      if (typeof current !== "object" && typeof current !== "function") return false;
      if (descriptor(current, "then") !== undefined) return false;
      current = prototypeOf(current);
    }
    return false;
  } catch {
    return false;
  }
}
