import { createError, toError } from "#veryfront/errors";
import type { ResolvedModelTransport } from "../types.ts";

/** The model the hook is told about, and a routing refusal held until it returns. */
export interface RoutedModel {
  modelString: string;
  refusal?: unknown;
}

/**
 * Route the configured model before the hook runs.
 *
 * Veryfront Cloud routing can refuse an explicit provider model outright (a
 * retired hosted model, say). Whether that refusal stands is only known once
 * the hook has run: a hook credential calls the provider directly. So when a
 * hook exists and the model names a direct provider, the refusal is held and
 * the hook sees the direct model.
 */
export function routeModelBeforeHook(options: {
  route: () => string;
  directModel: () => string | undefined;
  hasHook: boolean;
}): RoutedModel {
  try {
    return { modelString: options.route() };
  } catch (error) {
    const directModel = options.hasHook ? options.directModel() : undefined;
    if (directModel === undefined) throw error;
    return { modelString: directModel, refusal: error };
  }
}

/**
 * A returned `credential` property asks for that credential, whatever its
 * value. An unset one (a missing environment variable, say) must fail rather
 * than fall back to the process key and call under another identity.
 */
export function requestsCredential(
  transport: ResolvedModelTransport | null | undefined | void,
): transport is ResolvedModelTransport {
  return transport !== undefined && transport !== null && Object.hasOwn(transport, "credential");
}

function credentialConfigError(agentId: string, reason: string): Error {
  return toError(
    createError({
      type: "config",
      message: `resolveModelTransport for agent "${agentId}" returned a "credential" ${reason}`,
    }),
  );
}

/**
 * Settle the model string the call uses once the hook has returned.
 *
 * Without a credential the routed model stands, and so does a held refusal.
 * With one, the call goes to the provider the agent's own model names: an
 * explicit provider model routes through Veryfront Cloud only because the
 * environment holds no key for it, and the credential is that key. A model the
 * runtime chose (omitted or `auto`) cannot take a credential, because the
 * provider that would receive it depends on ambient keys.
 */
export function settleCredentialModel(options: {
  agentId: string;
  transport: ResolvedModelTransport | null | undefined | void;
  routed: RoutedModel;
  implicitModel: boolean;
  directModel: () => string | undefined;
}): string {
  if (!requestsCredential(options.transport)) {
    if (options.routed.refusal !== undefined) throw options.routed.refusal;
    return options.routed.modelString;
  }
  // The credential cannot apply to a runtime the hook built itself, so that
  // combination fails instead of dropping the credential.
  if (options.transport.model) {
    throw credentialConfigError(
      options.agentId,
      `and a "model". A credential applies only to a built-in provider runtime; ` +
        `configure the returned model runtime with its own credential instead.`,
    );
  }
  if (options.implicitModel) {
    throw credentialConfigError(
      options.agentId,
      `for an omitted or "auto" model. Set an explicit "provider/model" on the agent ` +
        `so the credential goes to the provider it belongs to.`,
    );
  }
  return options.directModel() ?? options.routed.modelString;
}
