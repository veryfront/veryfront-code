import { isNode } from "#veryfront/platform/compat/runtime.ts";

const NativeTypeError = TypeError;
const NativeObjectPrototype = Object.prototype;
const GetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;

export const RequestInitFields = Object.freeze(
  [
    "body",
    "cache",
    "client",
    "credentials",
    "duplex",
    "headers",
    "integrity",
    "keepalive",
    "method",
    "mode",
    "priority",
    "redirect",
    "referrer",
    "referrerPolicy",
    "signal",
    "window",
  ] as const,
);

/** Reject ambient Node RequestInit values before native dictionary conversion. */
export function assertNativeRequestDefaults(): void {
  if (!isNode) return;
  for (let index = 0; index < RequestInitFields.length; index++) {
    if (GetOwnPropertyDescriptor(NativeObjectPrototype, RequestInitFields[index]!)) {
      throw new NativeTypeError("Cannot construct a request with inherited option defaults");
    }
  }
}
