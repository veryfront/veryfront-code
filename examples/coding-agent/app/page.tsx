"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: Array<{ name: string; args: any }>;
  toolResults?: Array<{ name: string; result: any }>;
}

/**
 * Custom hook for agent chat with tool calls support
 * This follows the same pattern as Veryfront's useChat hook
 */
function useAgentChat(options: { api: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: "user",
      content: input.trim(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);
    setError(null);

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const response = await fetch(options.api, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMessage].map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      let assistantMessage: Message = {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        content: "",
      };

      setMessages((prev) => [...prev, assistantMessage]);

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n").filter((line) => line.trim());

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;

          try {
            const data = JSON.parse(line.slice(6));

            if (data.type === "chunk") {
              assistantMessage = {
                ...assistantMessage,
                content: assistantMessage.content + data.content,
              };
              setMessages((prev) => [...prev.slice(0, -1), assistantMessage]);
            } else if (data.type === "tool_call") {
              assistantMessage = {
                ...assistantMessage,
                toolCalls: [...(assistantMessage.toolCalls || []), data.toolCall],
              };
              setMessages((prev) => [...prev.slice(0, -1), assistantMessage]);
            } else if (data.type === "tool_result") {
              assistantMessage = {
                ...assistantMessage,
                toolResults: [...(assistantMessage.toolResults || []), data.toolCall],
              };
              setMessages((prev) => [...prev.slice(0, -1), assistantMessage]);
            } else if (data.type === "error") {
              assistantMessage = {
                ...assistantMessage,
                content: assistantMessage.content + `\n\nError: ${data.error}`,
              };
              setMessages((prev) => [...prev.slice(0, -1), assistantMessage]);
            }
          } catch (_e) {
            // Skip invalid JSON
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }

      const errorObj = err instanceof Error ? err : new Error(String(err));
      setError(errorObj);
      setMessages((prev) => [
        ...prev,
        {
          id: `error-${Date.now()}`,
          role: "assistant",
          content: `Error: ${errorObj.message}`,
        },
      ]);
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  }, [input, isLoading, messages, options.api]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value);
  }, []);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      await sendMessage();
    },
    [sendMessage],
  );

  return {
    messages,
    input,
    isLoading,
    error,
    setInput,
    handleInputChange,
    handleSubmit,
    sendMessage,
  };
}

export default function CodingAgentPage() {
  const { messages, input, isLoading, handleInputChange, handleSubmit } = useAgentChat({
    api: "/api/agent",
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  return (
    <div className="flex flex-col h-screen font-sans">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 bg-gray-50">
        <h1 className="m-0 text-2xl font-bold">Coding Agent</h1>
        <p className="mt-2 mb-0 text-sm text-gray-600">
          AI assistant with file operations, web search, and command execution
        </p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-auto p-4">
        {messages.length === 0 && (
          <div className="text-center p-8 text-gray-400">
            <p>Start a conversation with the coding agent</p>
            <p className="text-sm mt-2">
              Try: "List all TypeScript files in the project" or "Search the web for React best
              practices"
            </p>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`mb-4 p-4 rounded-lg ${
              message.role === "user" ? "bg-blue-50" : "bg-gray-50"
            }`}
          >
            <div
              className={`font-bold mb-2 ${
                message.role === "user" ? "text-blue-600" : "text-green-600"
              }`}
            >
              {message.role === "user" ? "You" : "Agent"}
            </div>
            <div className="whitespace-pre-wrap">{message.content}</div>

            {message.toolCalls && message.toolCalls.length > 0 && (
              <div className="mt-2 text-sm text-gray-600">
                <div className="font-bold">Tool Calls:</div>
                {message.toolCalls.map((tc, i) => (
                  <div key={i} className="ml-4">
                    {tc.name}({JSON.stringify(tc.args)})
                  </div>
                ))}
              </div>
            )}

            {message.toolResults && message.toolResults.length > 0 && (
              <div className="mt-2 text-sm text-gray-600">
                <div className="font-bold">Tool Results:</div>
                {message.toolResults.map((tr, i) => (
                  <div key={i} className="ml-4">
                    {tr.name}: {typeof tr.result === "string"
                      ? tr.result.slice(0, 100)
                      : JSON.stringify(tr.result).slice(0, 100)}...
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="p-4 text-gray-600 text-center">
            <div>Thinking...</div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-gray-200 bg-gray-50">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={handleInputChange}
            onKeyPress={(e) => e.key === "Enter" && !e.shiftKey && handleSubmit(e)}
            placeholder="Ask the coding agent..."
            disabled={isLoading}
            className="flex-1 p-3 border border-gray-300 rounded text-base"
          />
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isLoading || !input.trim()}
            className={`px-6 py-3 text-white border-0 rounded text-base font-bold ${
              isLoading || !input.trim()
                ? "bg-gray-300 cursor-not-allowed"
                : "bg-blue-600 cursor-pointer hover:bg-blue-700"
            }`}
          >
            {isLoading ? "Sending..." : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
}
