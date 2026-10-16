import { createVeryfrontApiOriginBoundOutboundFetch } from "#cli/outbound-fetch";
import { withOnboardingDeadline } from "./onboarding-fetch.ts";

/** Bound onboarding requests and response bodies on the trusted host transport. */
export function createCloudOnboardingTransport(apiUrl: string, timeoutMs = 10_000): typeof fetch {
  return withOnboardingDeadline(createVeryfrontApiOriginBoundOutboundFetch(apiUrl), timeoutMs);
}
