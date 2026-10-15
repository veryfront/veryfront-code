import { buildResponseInit } from "#veryfront/agent/service/response-init.ts";

// Capture host operations before project code can replace response intrinsics.
const IntrinsicReflectApply = Reflect.apply;
const NativeResponse = Response;
const NativeObjectPrototype = Object.prototype;
export const ResponseBodyGet = Object.getOwnPropertyDescriptor(NativeResponse.prototype, "body")!
  .get!;
export const ResponseHeadersGet = Object.getOwnPropertyDescriptor(
  NativeResponse.prototype,
  "headers",
)!
  .get!;
export const ResponseStatusGet = Object.getOwnPropertyDescriptor(
  NativeResponse.prototype,
  "status",
)!.get!;
const ResponseStatusTextGet = Object.getOwnPropertyDescriptor(
  NativeResponse.prototype,
  "statusText",
)!.get!;
const HeadersForEach = Headers.prototype.forEach;
const HeadersAppend = Headers.prototype.append;

// Node's constructor reads public response accessors while initializing its state.
// Shadow project-replaceable getters on a private, frozen prototype, including
// when a prior returned response exposes this subclass to project code.
class HostResponse extends NativeResponse {}
Object.defineProperties(HostResponse.prototype, {
  body: { get: ResponseBodyGet },
  headers: { get: ResponseHeadersGet },
  status: { get: ResponseStatusGet },
  statusText: { get: ResponseStatusTextGet },
});
Object.freeze(HostResponse.prototype);
Object.freeze(HostResponse);

export function readResponseValue<T>(response: Response, getter: () => T): T {
  return IntrinsicReflectApply(getter, response, []) as T;
}

/** Copy response metadata without invoking project-replaced accessors or iterators. */
export function copyNativeResponse(
  target: Response,
  body: ReadableStream<Uint8Array> | null = readResponseValue(target, ResponseBodyGet),
): Response {
  const init = buildResponseInit(
    NativeObjectPrototype,
    readResponseValue<number>(target, ResponseStatusGet),
    readResponseValue<string>(target, ResponseStatusTextGet),
  );
  const result = new HostResponse(
    body,
    init,
  );
  const headers = readResponseValue<Headers>(result, ResponseHeadersGet);
  IntrinsicReflectApply(HeadersForEach, readResponseValue<Headers>(target, ResponseHeadersGet), [
    (value: string, name: string) => IntrinsicReflectApply(HeadersAppend, headers, [name, value]),
  ]);
  return result;
}
