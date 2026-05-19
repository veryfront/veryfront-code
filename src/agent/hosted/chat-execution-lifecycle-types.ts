import type { ConversationHostedTerminalRuntimeAdapter } from "../conversation/hosted-terminal.ts";
import type { ConversationRunChunkMirror } from "../conversation/run-chunk-mirror.ts";

/** Public API contract for hosted chat execution lifecycle adapter. */
export interface HostedChatExecutionLifecycleAdapter
  extends ConversationHostedTerminalRuntimeAdapter {
  durableRootRun: {
    runId: string;
    messageId?: string | null;
  } | null;
  durableRunMirror: ConversationRunChunkMirror | null;
}
