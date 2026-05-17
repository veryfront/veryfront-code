/**
 * Bridge between BrowserInferenceClient (Worker) and useChat's streaming interface.
 *
 * Converts ChatMessage[] to simple {role, content}[] for the Worker,
 * and synthesizes the same streaming updates that handleStreamingResponse produces.
 */

import type {
  BrowserInferenceStatus,
  ChatMessage,
  ChatMessagePart,
} from "#veryfront/agent/react/use-chat/types.ts";
import { generateClientId } from "#veryfront/agent/react/use-chat/utils.ts";
import { BrowserInferenceClient } from "#veryfront/agent/react/use-chat/browser-inference/worker-client.ts";

/** Default max tokens for browser-side inference */
const DEFAULT_BROWSER_MAX_TOKENS = 512;
/** Default temperature for browser-side inference */
const DEFAULT_BROWSER_TEMPERATURE = 0.7;

interface BrowserInferenceCallbacks {
  onUpdate: (parts: ChatMessagePart[], messageId: string) => void;
  onMessage: (message: ChatMessage) => void;
  onStatusChange: (status: BrowserInferenceStatus) => void;
  onDownloadProgress?: (progress: number) => void;
  onError: (error: Error) => void;
}

function extractTextFromMessages(
  messages: ChatMessage[],
): Array<{ role: string; content: string }> {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => {
      const textPart = m.parts.find((p) => p.type === "text");
      const content = textPart && "text" in textPart ? textPart.text : "";
      return { role: m.role, content };
    })
    .filter((m) => m.content.length > 0);
}

export function runBrowserInference(
  messages: ChatMessage[],
  systemPrompt: string,
  callbacks: BrowserInferenceCallbacks,
): void {
  const client = BrowserInferenceClient.getInstance();
  const messageId = generateClientId("msg");
  const simpleMessages = extractTextFromMessages(messages);

  let accumulated = "";

  client.generate(
    messageId,
    simpleMessages,
    {
      systemPrompt,
      maxNewTokens: DEFAULT_BROWSER_MAX_TOKENS,
      temperature: DEFAULT_BROWSER_TEMPERATURE,
    },
    {
      onStatus: (status) => callbacks.onStatusChange(status),
      onDownloadProgress: (progress) => callbacks.onDownloadProgress?.(progress),
      onToken: (token) => {
        accumulated = token; // transformers.js callback_function sends full text each time
        const parts: ChatMessagePart[] = [
          { type: "text", text: accumulated, state: "streaming" },
        ];
        callbacks.onUpdate(parts, messageId);
      },
      onDone: (text) => {
        const finalParts: ChatMessagePart[] = [
          { type: "text", text: text || accumulated, state: "done" },
        ];
        const assistantMessage: ChatMessage = {
          id: messageId,
          role: "assistant",
          parts: finalParts,
        };
        callbacks.onMessage(assistantMessage);
        callbacks.onStatusChange("ready");
      },
      onError: (errorMsg) => {
        callbacks.onStatusChange("error");
        callbacks.onError(new Error(errorMsg));
      },
    },
  );
}

export function stopBrowserInference(): void {
  BrowserInferenceClient.getInstance().stop();
}
