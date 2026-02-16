/**
 * Bridge between BrowserInferenceClient (Worker) and useChat's streaming interface.
 *
 * Converts UIMessage[] to simple {role, content}[] for the Worker,
 * and synthesizes the same streaming updates that handleStreamingResponse produces.
 */

import type { BrowserInferenceStatus } from "../types.ts";
import type { UIMessage, UIMessagePart } from "../types.ts";
import { generateClientId } from "../utils.ts";
import { BrowserInferenceClient } from "./worker-client.ts";

export interface BrowserInferenceCallbacks {
  onUpdate: (parts: UIMessagePart[], messageId: string) => void;
  onMessage: (message: UIMessage) => void;
  onStatusChange: (status: BrowserInferenceStatus) => void;
  onDownloadProgress?: (progress: number) => void;
  onError: (error: Error) => void;
}

function extractTextFromMessages(
  messages: UIMessage[],
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
  messages: UIMessage[],
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
    { systemPrompt, maxNewTokens: 512, temperature: 0.7 },
    {
      onStatus: (status) => callbacks.onStatusChange(status),
      onDownloadProgress: (progress) => callbacks.onDownloadProgress?.(progress),
      onToken: (token) => {
        accumulated = token; // transformers.js callback_function sends full text each time
        const parts: UIMessagePart[] = [
          { type: "text", text: accumulated, state: "streaming" },
        ];
        callbacks.onUpdate(parts, messageId);
      },
      onDone: (text) => {
        const finalParts: UIMessagePart[] = [
          { type: "text", text: text || accumulated, state: "done" },
        ];
        const assistantMessage: UIMessage = {
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
