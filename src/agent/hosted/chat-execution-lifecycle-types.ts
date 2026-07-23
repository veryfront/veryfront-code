import type { ConversationHostedTerminalRuntimeAdapter } from "../conversation/hosted-terminal.ts";
import type { ConversationRunChunkMirror } from "../conversation/run-chunk-mirror.ts";

/** Public API contract for hosted chat execution lifecycle adapter. */
export interface HostedChatExecutionLifecycleAdapter
  extends ConversationHostedTerminalRuntimeAdapter {
  /** Durable root run value. */
  durableRootRun: {
    runId: string;
    messageId?: string | null;
  } | null;
  /** Durable run mirror value. */
  durableRunMirror: ConversationRunChunkMirror | null;
}
