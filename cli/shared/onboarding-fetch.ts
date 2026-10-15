const NativeResponse = Response;

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
    if (init?.signal) signals.push(init.signal);
    const signal = AbortSignal.any(signals);
    let rejectAborted!: (reason: unknown) => void;
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectAborted = reject;
    });
    const abort = () => rejectAborted(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    try {
      signal.throwIfAborted();
      return await Promise.race([
        (async () => {
          const response = await transport(input, { ...init, signal });
          if (!response.body) return response;
          const body = await response.arrayBuffer();
          return new NativeResponse(body, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        })(),
        aborted,
      ]);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    }
  };
}
