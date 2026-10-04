const parse = JSON.parse;
const decode = atob;
const apply = Reflect.apply;
const split = String.prototype.split;
const replaceAll = String.prototype.replaceAll;
function claims(token: string): Record<string, unknown> {
  const encoded = apply(split, token, ["."])[1];
  if (!encoded) throw new Error("Malformed terminal capability");
  return parse(decode(apply(replaceAll, apply(replaceAll, encoded, ["-", "+"]), ["_", "/"])));
}

/** Original runtime identity used only as a routing hint from an issued capability. */
export function terminalRoutingRunId(token: string): string {
  const value = claims(token).runId;
  if (typeof value !== "string" || !value) throw new Error("Malformed terminal capability");
  return value;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Routing hints from an existing private credential, never local authorization.
 * The API verifies the unchanged token, exact run binding and current generation.
 */
export function terminalRoute(
  token: string | undefined,
  runId: string,
): { id: string; generation: string } {
  try {
    if (!token || token.length > 16384) throw new Error();
    const claim = claims(token);
    if (
      claim.tokenUse !== "run_event_writer" || claim.writerPurpose !== "current_run_terminal" ||
      claim.runId !== runId || typeof claim.canonicalRunId !== "string" ||
      !uuid.test(claim.canonicalRunId) ||
      typeof claim.dispatchNonce !== "string" || !claim.dispatchNonce
    ) throw new Error();
    return { id: claim.canonicalRunId, generation: claim.dispatchNonce };
  } catch {
    throw new Error("Current run terminal authority is required");
  }
}
