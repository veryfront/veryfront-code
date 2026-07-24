/**
 * Chat stream watchdog compatibility barrel.
 *
 * The implementation lives in the stream lifecycle module so the watchdog and
 * the lifecycle runner share one absolute deadline primitive. This file owns
 * no timer implementation; it re-exports the stable public surface.
 */
export {
  ChatStreamIdleTimeoutError,
  type ChatStreamWatchdogOptions,
  type ChatStreamWatchdogPhase,
  type ChatStreamWatchdogState,
  createChatStreamWatchdog,
  createChatStreamWatchdogState,
  DEFAULT_CHAT_STREAM_IDLE_TIMEOUT_MS,
  DEFAULT_CHAT_STREAM_TOOL_RUNNING_TIMEOUT_MS,
  getNextChatStreamWatchdogState,
  isHeartbeatOnlyMetadataChunk,
  isLongRunningToolRunning,
  mapWatchdogChunkToLifecycleActivity,
  type WatchdogLifecycleActivity,
} from "../agent/streaming/lifecycle/watchdog-compat-adapter.ts";
