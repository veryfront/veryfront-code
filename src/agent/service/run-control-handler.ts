import { inheritIngressCredentials } from "#veryfront/security/http/ingress-credentials.ts";
import { cancelUnusedRequestBody } from "#veryfront/security/http/application-request.ts";
import { createAgUiCancelHandler, createAgUiResumeHandler } from "../ag-ui/run-control.ts";
import { boundAgUiRequestBody } from "../ag-ui/request-shared.ts";
import type { AgUiResumeValue } from "../ag-ui/tool-shared.ts";
import type { DetachedRunTracker } from "./detached-run-tracker.ts";
import type { HostedServiceAuthenticatedRequest } from "./auth.ts";
import { isSafeHostedJwtVerificationEnvironment } from "./jwt-verification-environment.ts";
import { isResponseLike } from "./response-like.ts";

const IntrinsicReflectApply = Reflect.apply;
const RequestClone = Request.prototype.clone;

interface RunControlOptions {
  tracker: DetachedRunTracker<AgUiResumeValue>;
  authenticateRequest(request: Request): Promise<HostedServiceAuthenticatedRequest | Response>;
  verifyRunCancellationToken?: (input: { token: string; runId: string }) => Promise<boolean>;
  verifyRunResumeToken?: (input: { token: string; runId: string }) => Promise<boolean>;
  setActiveSpanAttributes?: (
    attributes: Record<
      string,
      string | number | boolean | readonly (string | number | boolean)[] | null | undefined
    >,
  ) => void;
  trace?: <T>(name: string, operation: () => Promise<T>) => Promise<T>;
}

/** Authenticate and bound cancel/resume effects against the same admitted-run owner. */
export function createHostedRunControlHandler(options: RunControlOptions) {
  const trace: NonNullable<RunControlOptions["trace"]> = options.trace ??
    ((_name, operation) => operation());
  async function handle(input: {
    request: Request;
    runId: string | undefined;
  }, operation: "cancel" | "resume"): Promise<Response> {
    if (!isSafeHostedJwtVerificationEnvironment(input)) {
      return Response.json({ errorCode: "FORBIDDEN" }, { status: 403 });
    }
    return trace(
      operation === "cancel" ? "handler.durableChatRunCancel" : "handler.durableChatRunResume",
      async () => {
        if (!isSafeHostedJwtVerificationEnvironment(input)) {
          return Response.json({ errorCode: "FORBIDDEN" }, { status: 403 });
        }
        // Bound the original stream before a custom authenticator can parse its
        // clone. Otherwise the unread control branch buffers every byte it reads.
        let controlRequest = input.request;
        const boundedRequest = await boundAgUiRequestBody(
          controlRequest,
          `Invalid AG-UI ${operation} request`,
          operation === "cancel",
          operation === "resume",
        );
        if (isResponseLike(boundedRequest)) return boundedRequest;
        controlRequest = boundedRequest;
        const authenticationRequest = inheritIngressCredentials(
          controlRequest,
          IntrinsicReflectApply(RequestClone, controlRequest, []) as Request,
        );
        const authenticatedRequest = await options.authenticateRequest(authenticationRequest)
          .finally(() => cancelUnusedRequestBody(authenticationRequest));
        if (!isSafeHostedJwtVerificationEnvironment(authenticatedRequest)) {
          return Response.json({ errorCode: "FORBIDDEN" }, { status: 403 });
        }
        if (isResponseLike(authenticatedRequest)) {
          return authenticatedRequest;
        }

        const runId = input.runId;
        if (!runId) {
          return Response.json({ errorCode: "VALIDATION_ERROR" }, { status: 400 });
        }

        const verifyRunToken = operation === "cancel"
          ? options.verifyRunCancellationToken
          : options.verifyRunResumeToken;

        options.setActiveSpanAttributes?.({ "run.id": runId });
        const createControlHandler = operation === "cancel"
          ? createAgUiCancelHandler<AgUiResumeValue>
          : createAgUiResumeHandler;
        const controlHandler = createControlHandler({
          sessionManager: options.tracker.sessionManager,
          hasSettledExecution: (runId: string) =>
            options.tracker.hasSettledExecution?.(runId) === true,
          hasPendingExecution: (runId: string) =>
            options.tracker.hasPendingExecution?.(runId) === true,
          resolveRunId: () => runId,
          // The single verification for this request. Checking here as well
          // would spend a one-time grant before the effect handler asks for its
          // own authority, and would answer a throwing or non-boolean verifier
          // with an uncaught error: only `authorizeRunControl` turns those into
          // a controlled denial. A missing verifier still denies.
          authorizeRunControl: async (control) => {
            const decision = await verifyRunToken?.({
              token: authenticatedRequest.authToken,
              runId: control.runId,
            });
            return decision === true && isSafeHostedJwtVerificationEnvironment();
          },
        });
        return controlHandler(controlRequest);
      },
    );
  }

  return handle;
}
