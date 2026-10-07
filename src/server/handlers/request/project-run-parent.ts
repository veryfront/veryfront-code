import { UUID_PATTERN } from "#veryfront/chat/conversation.ts";
import { ORCHESTRATION_ERROR } from "#veryfront/errors";
const parse = JSON.parse;
const decode = atob;
const indexOf = String.prototype.indexOf;
const slice = String.prototype.slice;
const apply = Reflect.apply;
const uuid = new RegExp(`^(?:${UUID_PATTERN.source})$`, UUID_PATTERN.flags);

/** Routing hints only: the API validates the unchanged issuer token and its current execution lease. */
export function readProjectExecutionParent(
  token: string,
  runId: string,
  projectId: string,
): { canonicalRunId: string; attemptId: string } {
  try {
    if (!token || token.length > 16384) throw new Error();
    const first = apply(indexOf, token, ["."]);
    const second = apply(indexOf, token, [".", first + 1]);
    if (first < 0 || second <= first + 1) throw new Error();
    const encoded: string = apply(slice, token, [first + 1, second]);
    let base64 = "";
    for (let offset = 0; offset < encoded.length; offset++) {
      const character = apply(slice, encoded, [offset, offset + 1]);
      base64 += character === "-" ? "+" : character === "_" ? "/" : character;
    }
    const value = parse(decode(base64));
    if (
      value.tokenUse !== "run_event_writer" || value.runId !== runId ||
      value.projectId !== projectId ||
      typeof value.projectExecutionAttempt?.canonicalRunId !== "string" ||
      !uuid.test(value.projectExecutionAttempt.canonicalRunId) ||
      typeof value.projectExecutionAttempt?.attemptId !== "string" ||
      !value.projectExecutionAttempt.attemptId ||
      typeof value.projectExecutionAttempt?.workerId !== "string" ||
      !value.projectExecutionAttempt.workerId
    ) throw new Error();
    return {
      canonicalRunId: value.projectExecutionAttempt.canonicalRunId,
      attemptId: value.projectExecutionAttempt.attemptId,
    };
  } catch {
    throw ORCHESTRATION_ERROR.create({
      detail: "Project child execution requires current run authority",
    });
  }
}
