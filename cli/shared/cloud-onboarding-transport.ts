import { createVeryfrontApiOriginBoundOutboundFetch } from "#cli/outbound-fetch";

/** Bound each onboarding request, including credential validation and response body reads. */
export function createCloudOnboardingTransport(apiUrl: string, timeoutMs = 10_000): typeof fetch {
  const transport = createVeryfrontApiOriginBoundOutboundFetch(apiUrl);
  return (input, init) => {
    const initSignal = init && "signal" in init ? init.signal : undefined;
    const callerSignal = initSignal instanceof AbortSignal
      ? initSignal
      : input instanceof Request
      ? input.signal
      : undefined;
    const deadline = AbortSignal.timeout(timeoutMs);
    return transport(input, {
      ...init,
      signal: callerSignal ? AbortSignal.any([callerSignal, deadline]) : deadline,
    });
  };
}
