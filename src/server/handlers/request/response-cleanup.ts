import { buildResponseInit } from "#veryfront/agent/service/response-init.ts";

const IntrinsicReflectApply = Reflect.apply;
const NativeResponse = Response;
const NativeReadableStream = ReadableStream;
const NativeObjectPrototype = Object.prototype;
const ResponseBodyGet = Object.getOwnPropertyDescriptor(NativeResponse.prototype, "body")!.get!;
const ResponseHeadersGet = Object.getOwnPropertyDescriptor(NativeResponse.prototype, "headers")!
  .get!;
const ResponseStatusGet = Object.getOwnPropertyDescriptor(NativeResponse.prototype, "status")!.get!;
const ResponseStatusTextGet = Object.getOwnPropertyDescriptor(
  NativeResponse.prototype,
  "statusText",
)!.get!;
const HeadersForEach = Headers.prototype.forEach;
const HeadersAppend = Headers.prototype.append;

function readResponseValue<T>(response: Response, getter: () => T): T {
  return IntrinsicReflectApply(getter, response, []) as T;
}

/** Keep invocation resources alive until its response finishes or is cancelled. */
export function withResponseCleanup(
  response: Response,
  cleanup: () => void,
  signal: AbortSignal,
): Response {
  const body = readResponseValue<ReadableStream<Uint8Array> | null>(response, ResponseBodyGet);
  if (!body) {
    cleanup();
    return response;
  }
  const reader = body.getReader();
  let finished = false;
  let cancellation: Promise<void> | undefined;
  const finish = () => {
    if (finished) return;
    finished = true;
    signal.removeEventListener("abort", abort);
    try {
      cleanup();
    } finally {
      reader.releaseLock();
    }
  };
  const cancel = (reason: unknown): Promise<void> => {
    if (finished) return cancellation ?? Promise.resolve();
    cancellation ??= Promise.resolve().then(() => reader.cancel(reason)).finally(finish);
    return cancellation;
  };
  const abort = () => {
    // Cancellation failure still retires the invocation, and must not create
    // an unhandled rejection in the request signal's event listener.
    void cancel(signal.reason).catch(() => {});
  };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const result = new NativeResponse(
    new NativeReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          if (finished) {
            if (cancellation) await cancellation;
            controller.close();
            return;
          }
          const result = await reader.read();
          if (result.done) {
            if (cancellation) await cancellation;
            finish();
            controller.close();
          } else controller.enqueue(result.value);
        } catch (error) {
          finish();
          controller.error(error);
        }
      },
      cancel,
    }, { highWaterMark: 0 }),
    buildResponseInit(
      NativeObjectPrototype,
      readResponseValue<number>(response, ResponseStatusGet),
      readResponseValue<string>(response, ResponseStatusTextGet),
    ),
  );
  const headers = readResponseValue<Headers>(result, ResponseHeadersGet);
  IntrinsicReflectApply(HeadersForEach, readResponseValue<Headers>(response, ResponseHeadersGet), [
    (value: string, name: string) => IntrinsicReflectApply(HeadersAppend, headers, [name, value]),
  ]);
  return result;
}
