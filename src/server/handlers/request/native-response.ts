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
  const result = new NativeResponse(
    body,
    init,
  );
  const headers = readResponseValue<Headers>(result, ResponseHeadersGet);
  IntrinsicReflectApply(HeadersForEach, readResponseValue<Headers>(target, ResponseHeadersGet), [
    (value: string, name: string) => IntrinsicReflectApply(HeadersAppend, headers, [name, value]),
  ]);
  return result;
}
