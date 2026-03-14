/**
 * Channel Invoke Handler
 *
 * Handles inbound channel dispatch requests from veryfront-api.
 * The dispatch worker POSTs to /channels/invoke with the user's message
 * and conversation history. This handler runs the message through the
 * project's registered agent and returns a JSON response.
 *
 * @module server/handlers/request/channel-invoke
 */

import { BaseHandler } from "../response/base.ts";
import type {
  HandlerContext,
  HandlerMetadata,
  HandlerPriority,
  HandlerResult,
} from "../types.ts";
import { PRIORITY_MEDIUM_API } from "#veryfront/utils/constants/index.ts";
import { agentRegistry } from "#veryfront/agent/composition/index.ts";
import { serverLogger } from "#veryfront/utils";

const logger = serverLogger.component("channel-invoke");

interface ChannelInvokeRequest {
  dispatchId: string;
  conversationId: string;
  projectId: string;
  agentConfigId: string;
  platform: string;
  inboundMessage: {
    text: string;
    userId: string;
    userName: string;
    isDirectMessage: boolean;
  };
  conversationHistory?: Array<{
    id: string;
    role: string;
    parts: Array<{ type: string; text?: string }>;
  }>;
  generation?: {
    maxResponseTokens?: number;
  };
}

interface ChannelInvokeResponse {
  ignored: boolean;
  responseParts?: Array<{ type: string; text?: string }>;
  tokenUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  error?: {
    code: string;
    retryable: boolean;
  };
}

export class ChannelInvokeHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "ChannelInvokeHandler",
    priority: (PRIORITY_MEDIUM_API - 1) as HandlerPriority,
    patterns: [{ pattern: "/channels/invoke", exact: true }],
  };

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (!this.shouldHandle(req, ctx)) return this.continue();
    if (req.method !== "POST") return this.continue();

    const builder = this.createResponseBuilder(ctx);

    try {
      const body: ChannelInvokeRequest = await req.json();

      if (!body.dispatchId || body.inboundMessage?.text === undefined) {
        return this.respond(
          builder.json(
            { ignored: false, error: { code: "invalid_request", retryable: false } } satisfies ChannelInvokeResponse,
            400,
          ),
        );
      }

      // Find a registered agent to handle the message
      const allAgents = agentRegistry.getAll();
      if (allAgents.size === 0) {
        logger.warn("No agents registered for channel invoke", {
          projectId: body.projectId,
          dispatchId: body.dispatchId,
        });
        return this.respond(
          builder.json(
            { ignored: false, error: { code: "no_agent_configured", retryable: false } } satisfies ChannelInvokeResponse,
            200,
          ),
        );
      }

      // Use the first registered agent
      const [agentId, agent] = allAgents.entries().next().value!;

      logger.info("Channel invoke: running agent", {
        agentId,
        dispatchId: body.dispatchId,
        platform: body.platform,
        messageLength: body.inboundMessage.text.length,
      });

      // Build messages from conversation history + inbound message
      const messages = [
        ...(body.conversationHistory ?? [])
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({
            id: m.id,
            role: m.role as "user" | "assistant",
            parts: m.parts
              .filter((p) => p.type === "text" && p.text)
              .map((p) => ({ type: "text" as const, text: p.text! })),
          })),
        {
          id: `channel_${body.dispatchId}`,
          role: "user" as const,
          parts: [{ type: "text" as const, text: body.inboundMessage.text }],
        },
      ];

      const result = await agent.generate({
        input: messages,
        context: {
          platform: body.platform,
          channelUserId: body.inboundMessage.userId,
          channelUserName: body.inboundMessage.userName,
          isDirectMessage: body.inboundMessage.isDirectMessage,
          conversationId: body.conversationId,
        },
      });

      const response: ChannelInvokeResponse = {
        ignored: false,
        responseParts: [{ type: "text", text: result.text }],
        tokenUsage: result.usage
          ? {
            inputTokens: result.usage.promptTokens,
            outputTokens: result.usage.completionTokens,
            totalTokens: result.usage.totalTokens,
          }
          : undefined,
      };

      return this.respond(builder.json(response, 200));
    } catch (error) {
      logger.error("Channel invoke failed", {
        error: error instanceof Error ? error.message : String(error),
      });

      return this.respond(
        builder.json(
          { ignored: false, error: { code: "runtime_error", retryable: true } } satisfies ChannelInvokeResponse,
          200,
        ),
      );
    }
  }
}
