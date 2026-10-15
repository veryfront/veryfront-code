const apply = Reflect.apply;
const ResponseClone = Response.prototype.clone;
const ResponseJson = Response.prototype.json;
const ResponseBodyGet = Object.getOwnPropertyDescriptor(Response.prototype, "body")!.get!;
const ResponseHeadersGet = Object.getOwnPropertyDescriptor(Response.prototype, "headers")!.get!;
const ResponseOkGet = Object.getOwnPropertyDescriptor(Response.prototype, "ok")!.get!;
const ResponseStatusGet = Object.getOwnPropertyDescriptor(Response.prototype, "status")!.get!;
const ResponseStatusTextGet = Object.getOwnPropertyDescriptor(Response.prototype, "statusText")!
  .get!;
const HeadersGet = Headers.prototype.get;
const StreamGetReader = ReadableStream.prototype.getReader;
const StreamCancel = ReadableStream.prototype.cancel;
const ReaderRead = ReadableStreamDefaultReader.prototype.read;
const ReaderCancel = ReadableStreamDefaultReader.prototype.cancel;
const ReaderRelease = ReadableStreamDefaultReader.prototype.releaseLock;
const ObjectDefineProperty = Object.defineProperty;
const ObjectCreate = Object.create;

function bindOnboardingResponse(response: Response): Response {
  const bind = (target: Response | Headers | ReadableStream<Uint8Array>, name: string, value: unknown) => {
    const descriptor = ObjectCreate(null);
    descriptor.value = value;
    ObjectDefineProperty(target, name, descriptor);
  };
  bind(response, "then", undefined);
  const body = apply(ResponseBodyGet, response, []) as ReadableStream<Uint8Array> | null;
  if (body) bind(body, "cancel", (reason?: unknown) => apply(StreamCancel, body, [reason]));
  bind(response, "body", body);
  bind(response, "ok", apply(ResponseOkGet, response, []));
  bind(response, "status", apply(ResponseStatusGet, response, []));
  bind(response, "statusText", apply(ResponseStatusTextGet, response, []));
  const headers = apply(ResponseHeadersGet, response, []) as Headers;
  bind(headers, "get", (name: string) => apply(HeadersGet, headers, [name]));
  bind(response, "headers", headers);
  bind(response, "json", () => apply(ResponseJson, response, []));
  return response;
}

/** Bound small onboarding responses through body consumption, not just response headers. */
export function withOnboardingDeadline(
  transport: typeof fetch,
  timeoutMs = 10_000,
): typeof fetch {
  return async (input, init) => {
    const deadline = new AbortController();
    const timer = setTimeout(() =>
      deadline.abort(
        new DOMException(
          "Veryfront Cloud setup timed out. Check your API connection and retry. Your login was retained.",
          "TimeoutError",
        ),
      ), timeoutMs);
    const signals = [deadline.signal];
    if (input instanceof Request) signals.push(input.signal);
    if (init && "signal" in init && init.signal) signals.push(init.signal);
    const signal = AbortSignal.any(signals);
    let rejectAborted!: (reason: unknown) => void;
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAborted = reject;
    });
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let cloneBody: ReadableStream<Uint8Array> | null = null;
    const cancel = (reason: unknown) => {
      if (reader) void (apply(ReaderCancel, reader, [reason]) as Promise<void>).catch(() => {});
      if (cloneBody) {
        void (apply(StreamCancel, cloneBody, [reason]) as Promise<void>).catch(() => {});
      }
    };
    const abort = () => {
      cancel(signal.reason);
      rejectAborted(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      signal.throwIfAborted();
      return await Promise.race([
        (async () => {
          const response = await transport(input, { ...init, signal });
          const body = apply(ResponseBodyGet, response, []) as ReadableStream<Uint8Array> | null;
          if (signal.aborted) {
            if (body) {
              void (apply(StreamCancel, body, [signal.reason]) as Promise<void>).catch(() => {});
            }
            signal.throwIfAborted();
          }
          if (!body) return bindOnboardingResponse(response);
          // Clone uses native response slots; constructing a replacement invokes
          // project-replaceable response getters inside Node's constructor.
          const clone = apply(ResponseClone, response, []) as Response;
          cloneBody = apply(ResponseBodyGet, clone, []) as ReadableStream<Uint8Array>;
          reader = apply(
            StreamGetReader,
            apply(ResponseBodyGet, response, []),
            [],
          ) as ReadableStreamDefaultReader<Uint8Array>;
          try {
            while (!(await apply(ReaderRead, reader, [])).done) signal.throwIfAborted();
          } finally {
            apply(ReaderRelease, reader, []);
          }
          return bindOnboardingResponse(clone);
        })(),
        aborted,
      ]);
    } catch (error) {
      cancel(error);
      throw error;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
  };
}
