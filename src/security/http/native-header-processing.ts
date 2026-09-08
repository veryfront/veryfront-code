import { isNode } from "#veryfront/platform/compat/runtime.ts";

const FunctionPrototype = Function.prototype;
const NativeFunctionCall = FunctionPrototype.call;
const GetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const HasOwn = Object.hasOwn;
const NativeTypeError = TypeError;
const GetPrototypeOf = Object.getPrototypeOf;
const HeadersPrototype = Headers.prototype;
const IteratorSymbol = Symbol.iterator;
const HeadersIterator = GetOwnPropertyDescriptor(HeadersPrototype, IteratorSymbol)?.value;
const HeaderIteratorPrototype = GetPrototypeOf(new Headers().entries());
const HeaderIteratorNext = GetOwnPropertyDescriptor(HeaderIteratorPrototype, "next")?.value;
const IteratorPrototype = GetPrototypeOf(HeaderIteratorPrototype);
const IteratorIterator = GetOwnPropertyDescriptor(IteratorPrototype, IteratorSymbol)?.value;

function hasDataValue(target: object, property: PropertyKey, value: unknown): boolean {
  const descriptor = GetOwnPropertyDescriptor(target, property);
  return !!descriptor && HasOwn(descriptor, "value") && descriptor.value === value;
}

/** Reject the known mutable Node callback dependency before processing headers. */
export function assertNativeHeaderProcessing(): void {
  if (!isNode) return;
  if (!hasDataValue(FunctionPrototype, "call", NativeFunctionCall)) {
    throw new NativeTypeError("Cannot process headers with modified native callback dispatch");
  }
  if (
    !hasDataValue(HeadersPrototype, IteratorSymbol, HeadersIterator) ||
    !hasDataValue(HeaderIteratorPrototype, "next", HeaderIteratorNext) ||
    GetOwnPropertyDescriptor(HeaderIteratorPrototype, IteratorSymbol) !== undefined ||
    GetPrototypeOf(HeaderIteratorPrototype) !== IteratorPrototype ||
    !hasDataValue(IteratorPrototype, IteratorSymbol, IteratorIterator)
  ) {
    throw new NativeTypeError("Cannot process headers with modified native iteration");
  }
}
