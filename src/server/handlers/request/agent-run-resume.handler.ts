import {
  ControlPlaneRequestError,
  verifyControlPlaneRequest,
} from "#veryfront/internal-agents/control-plane-auth.ts";
import {
  type AgentRunSessionManager,
  agentRunSessionManager,
  RunNotActiveError,
  ToolResultConflictError,
  ToolResultNotWaitingError,
} from "#veryfront/internal-agents/session-manager.ts";
import { ResumeSignalSchema } from "#veryfront/internal-agents/schema.ts";
import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { PRIORITY_MEDIUM_API } from "#veryfront/utils/constants/index.ts";

const RESUME_PATH_REGEX = /^\/internal\/agents\/runs\/([^/]+)\/resume$/;

function getRunId(pathname: string): string | null {
  return RESUME_PATH_REGEX.exec(pathname)?.[1] ?? null;
}

export class AgentRunResumeHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "AgentRunResumeHandler",
    priority: PRIORITY_MEDIUM_API as HandlerPriority,
    patterns: [{ pattern: "/internal/agents/runs/", prefix: true, method: "POST" }],
  };

  constructor(private readonly sessionManager: AgentRunSessionManager = agentRunSessionManager) {
    super();
  }

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (!this.shouldHandle(req, ctx)) {
      return this.continue();
    }

    const runId = getRunId(new URL(req.url).pathname);
    if (!runId) {
      return this.continue();
    }

    return this.withProxyContext(ctx, async () => {
      const builder = this.createResponseBuilder(ctx)
        .withCORS(req, ctx.securityConfig?.cors)
        .withSecurity(ctx.securityConfig ?? undefined, req);

      const rawBody = await req.text();
      try {
        await verifyControlPlaneRequest(req, ctx, rawBody, {
          expectedSubject: runId,
          expectedSurface: "studio",
        });

        const signal = ResumeSignalSchema.parse(JSON.parse(rawBody));
        const outcome = this.sessionManager.submitToolResult(runId, {
          toolCallId: signal.toolCallId,
          result: signal.result,
          isError: signal.isError,
        });

        return this.respond(builder.json(outcome, 200));
      } catch (error) {
        if (error instanceof ControlPlaneRequestError) {
          return this.respond(builder.json({ error: error.message }, error.status));
        }

        if (error instanceof SyntaxError || (error instanceof Error && error.name === "ZodError")) {
          return this.respond(builder.json({ error: "Invalid resume request" }, 400));
        }

        if (error instanceof ToolResultConflictError) {
          return this.respond(builder.json({ error: "TOOL_RESULT_CONFLICT" }, 409));
        }

        if (error instanceof ToolResultNotWaitingError) {
          return this.respond(builder.json({ error: "TOOL_RESULT_NOT_WAITING" }, 409));
        }

        if (error instanceof RunNotActiveError) {
          return this.respond(builder.json({ error: "RUN_NOT_ACTIVE" }, 410));
        }

        this.logWarn("Internal agent run resume failed", {
          error: error instanceof Error ? error.message : String(error),
          runId,
          projectId: ctx.projectId,
          projectSlug: ctx.projectSlug,
        });
        return this.respond(builder.json({ error: "Internal resume failed" }, 500));
      }
    });
  }
}
