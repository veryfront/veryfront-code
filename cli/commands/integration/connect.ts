import { defineError, INVALID_ARGUMENT, retryWithBackoff } from "veryfront/errors";
import type { IntegrationClient, IntegrationConnectionStatus } from "veryfront/integrations";
import { canOpenBrowser, openBrowser } from "../../auth/browser.ts";
import { getCallbackUrl } from "../../auth/callback-server.ts";
import {
  type LoopbackCallbackServer,
  startLoopbackCallbackServer,
} from "../../shared/loopback-callback-server.ts";
import { createIntegrationCallbackHandler, type IntegrationCallback } from "./callback.ts";
import {
  collectIntegrationRows,
  type IntegrationCommandOptions,
  requireIntegrationTarget,
} from "./command.ts";

const CONNECT_FAILED = defineError({
  slug: "integration-connect-unconfirmed",
  category: "RUNTIME",
  status: 409,
  title: "Integration connection was not confirmed",
});
const CONSENT_DENIED = defineError({
  slug: "integration-consent-denied",
  category: "RUNTIME",
  status: 403,
  title: "Integration consent was denied",
});
export interface IntegrationConnectDependencies {
  canOpenBrowser?: typeof canOpenBrowser;
  openBrowser?: typeof openBrowser;
  startReceiver?: typeof startLoopbackCallbackServer<IntegrationCallback>;
  now?: () => number;
}
function identity(status: IntegrationConnectionStatus): { id?: string; generation?: string } {
  return {
    id: status.connection_id ?? status.connectionId,
    generation: status.connection_generation_id ?? status.connectionGenerationId,
  };
}
export async function connectIntegration(
  client: IntegrationClient,
  options: IntegrationCommandOptions,
  dependencies: IntegrationConnectDependencies = {},
  signal?: AbortSignal,
): Promise<unknown> {
  const integration = requireIntegrationTarget(options);
  const now = dependencies.now ?? Date.now;
  let receiver: LoopbackCallbackServer<IntegrationCallback> | undefined;
  let before: IntegrationConnectionStatus | undefined;
  let deadline = 0;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const localDeadline = new AbortController();
  const connectSignal = signal
    ? AbortSignal.any([signal, localDeadline.signal])
    : localDeadline.signal;
  const localTimeout = () =>
    CONNECT_FAILED.create({
      detail: "The local callback wait deadline elapsed. Start a new connect operation.",
    });
  try {
    const handoff = await client.connect(integration, {
      scope: options.scope,
      abortSignal: connectSignal,
      redirectUri: async () => {
        signal?.throwIfAborted();
        if (options.noBrowser) {
          if (!options.redirectUri) {
            throw INVALID_ARGUMENT.create({
              detail: "OAuth --no-browser requires --redirect-uri.",
            });
          }
          return options.redirectUri;
        }
        if (options.redirectUri) {
          throw INVALID_ARGUMENT.create({
            detail:
              "Use --redirect-uri only with --no-browser; interactive connection owns its loopback callback.",
          });
        }
        if (!(dependencies.canOpenBrowser ?? canOpenBrowser)()) {
          throw INVALID_ARGUMENT.create({
            detail:
              "Browser access is unavailable. Use --no-browser --redirect-uri <uri> for an explicit handoff.",
          });
        }
        before = await client.status(integration, options.scope);
        const nonce = crypto.randomUUID();
        receiver = await (dependencies.startReceiver ?? startLoopbackCallbackServer)({
          handle: createIntegrationCallbackHandler({
            nonce,
            integration,
            projectId: client.project.id,
            scope: options.scope,
          }),
        });
        const redirect = new URL(getCallbackUrl(receiver.port));
        for (
          const [key, value] of Object.entries({
            state: nonce,
            integration,
            project_id: client.project.id,
            scope: options.scope,
          })
        ) redirect.searchParams.set(key, value);
        deadline = now() + options.timeout * 1000;
        deadlineTimer = setTimeout(
          () => localDeadline.abort(localTimeout()),
          options.timeout * 1000,
        );
        return redirect.href;
      },
    });
    if (handoff.status !== "oauth_handoff") return handoff;
    if (options.noBrowser) {
      return {
        status: handoff.status,
        integration: handoff.integration,
        project_id: handoff.project_id,
        scope: handoff.scope,
        connect_url: handoff.connect_url,
        expires_at: handoff.expires_at,
      };
    }
    if (!receiver || Date.parse(handoff.expires_at) <= now()) {
      throw CONNECT_FAILED.create({
        detail:
          "The browser handoff expired before it could be opened. Start a new connect operation.",
      });
    }
    connectSignal.throwIfAborted();
    if (deadline <= now()) throw localTimeout();
    try {
      await (dependencies.openBrowser ?? openBrowser)(handoff.connect_url, {
        signal: connectSignal,
        timeoutMs: deadline - now(),
      });
    } catch {
      connectSignal.throwIfAborted();
      if (deadline <= now()) throw localTimeout();
      throw CONNECT_FAILED.create({
        detail:
          "The browser could not be opened. Start a new connect operation or use an explicit headless handoff.",
      });
    }
    const callback = await receiver.waitForCallback(deadline - now(), connectSignal);
    if (callback.status === "denied") throw CONSENT_DENIED.create();
    if (callback.status !== "received") {
      throw CONNECT_FAILED.create({ detail: "The provider returned a connection error." });
    }
    const propagation = new AbortController();
    const propagationSignal = signal
      ? AbortSignal.any([signal, propagation.signal])
      : propagation.signal;
    const budgetMs = Math.min(10000, deadline - now());
    const unconfirmed = () =>
      CONNECT_FAILED.create({
        detail:
          "The callback arrived, but fresh matching connection metadata was not observed. Inspect integration status and connections before calling a tool.",
      });
    if (budgetMs <= 0) throw unconfirmed();
    const timer = setTimeout(() => propagation.abort(unconfirmed()), budgetMs);
    try {
      return await retryWithBackoff(async () => {
        propagationSignal.throwIfAborted();
        const status = await client.status(integration, options.scope, {
          abortSignal: propagationSignal,
        });
        const connections = await collectIntegrationRows(
          client.listConnections(integration, { abortSignal: propagationSignal }),
        );
        propagationSignal.throwIfAborted();
        const current = identity(status), previous = before ? identity(before) : {};
        const observed = connections.find((row) =>
          row.id === current.id && row.connection_generation_id === current.generation &&
          row.scope === options.scope && row.status === "connected"
        );
        if (
          !status.connected || !current.id || !current.generation || !observed ||
          (before?.connected && current.id === previous.id &&
            current.generation === previous.generation)
        ) throw unconfirmed();
        return {
          status: "connection_observed",
          integration,
          scope: options.scope,
          connection: observed,
          connection_status: status,
        };
      }, {
        maxAttempts: 4,
        initialDelay: 250,
        maxDelay: 1000,
        abortSignal: propagationSignal,
        shouldRetry: (error) =>
          error instanceof Error && "slug" in error && error.slug === CONNECT_FAILED.slug,
        onRetry: () => {},
        wrapFinalError: () => unconfirmed(),
      });
    } finally {
      clearTimeout(timer);
    }
  } finally {
    if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
    await receiver?.stop();
  }
}
