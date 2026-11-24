import type { HostedServiceAuth } from "./auth.ts";
import type { BrokerIngressScopeInput } from "./broker-ingress.ts";

type CanonicalBrokerAuth =
  & Pick<HostedServiceAuth, "verifyJwt" | "verifyRunEventAppendToken">
  & Required<Pick<HostedServiceAuth, "verifyRunTerminalToken">>;

/**
 * Authorize canonical broker ingress with the existing independent credential verifiers.
 * The signed ingress binds the immutable source; writer and terminal authority name
 * the consuming execution project instead. Canonical preparation separately reads
 * the current run through its execution API credential before any allocation.
 */
export function createCanonicalBrokerAuthorizer(auth: CanonicalBrokerAuth) {
  if (
    typeof auth?.verifyJwt !== "function" ||
    typeof auth.verifyRunEventAppendToken !== "function" ||
    typeof auth.verifyRunTerminalToken !== "function"
  ) throw new TypeError("Canonical broker credential verifiers are required");
  const verifyJwt = auth.verifyJwt.bind(auth);
  const verifyWriter = auth.verifyRunEventAppendToken.bind(auth);
  const verifyTerminal = auth.verifyRunTerminalToken.bind(auth);
  return async (input: BrokerIngressScopeInput) => {
    const bearer = /^Bearer ([^\s]+)$/i.exec(input.authorization)?.[1];
    if (!bearer || !input.terminalAuthToken) return undefined;
    const principal = await verifyJwt(bearer);
    if (principal.success !== true) return undefined;
    const scope = {
      projectId: input.run.project.projectId,
      runId: input.run.runId,
    };
    const runEventWriter = await verifyWriter({
      ...scope,
      agentId: input.run.agentId,
      token: input.runEventToken,
    });
    if (runEventWriter.verified !== true) return undefined;
    if (await verifyTerminal({ ...scope, token: input.terminalAuthToken }) !== true) {
      return undefined;
    }
    // Preserve the original writer result: it carries private, verified platform
    // dependency provenance which a serialized or reconstructed object cannot own.
    return Object.freeze({
      principal: Object.freeze({ userId: principal.userId }),
      runEventWriter,
    });
  };
}
