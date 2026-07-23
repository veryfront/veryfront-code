import type { IntegrationName } from "./schema.ts";

/**
 * Integrations whose checked-in templates need a provider-specific auth/API
 * adapter before they can be emitted safely.
 *
 * Feature flags control visibility of experimental source. They must not turn
 * incomplete protocol support into a generated application that fails only at
 * runtime.
 */
const TEMPLATE_GENERATION_BLOCKERS = {
  box:
    "provider-specific token exchange and revocation; checked-in template has no operational files",
  clickup: "non-standard token exchange; checked-in template has no operational files",
  freshdesk: "tenant-specific OAuth and API origins",
  harvest:
    "provider-specific OAuth callback and API adapter; checked-in template has no operational files",
  hubspot:
    "provider-specific OAuth callback and API adapter; checked-in template has no operational files",
  intercom:
    "region-specific authorization and non-standard token exchange; checked-in template has no operational files",
  mailchimp: "a response-derived data-center API origin",
  monday:
    "provider-specific OAuth 2.1 token lifetime handling; checked-in template has no operational files",
  pipedrive: "a response-derived company API origin",
  quickbooks: "callback realm binding and a company-scoped API adapter",
  salesforce: "a response-derived instance URL and provider-specific adapter",
  shopify: "a validated shop domain and provider-specific callback verification",
  trello: "an OAuth 1.0 provider-specific adapter",
  twitter: "checked-in template has no operational files",
  webex: "checked-in template has no operational files",
  xero: "tenant selection and a tenant-scoped API adapter",
  zoom: "checked-in template has no operational files",
} as const satisfies Partial<Record<IntegrationName, string>>;

/** Explain why a declared integration cannot yet be generated safely. */
export function getIntegrationTemplateGenerationBlocker(
  name: IntegrationName,
): string | undefined {
  return TEMPLATE_GENERATION_BLOCKERS[name as keyof typeof TEMPLATE_GENERATION_BLOCKERS];
}

/** Whether the checked-in template is safe to emit as an application. */
export function isIntegrationTemplateGeneratable(name: IntegrationName): boolean {
  return getIntegrationTemplateGenerationBlocker(name) === undefined;
}
