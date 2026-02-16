/**
 * BrowserInferenceClient — manages Web Worker lifecycle for browser-side inference.
 *
 * Singleton per session. Lazily creates Worker on first generate() call.
 * Uses inline Blob URL approach — no separate build entry point needed.
 */

import type { WorkerRequest, WorkerResponse } from "./types.ts";
import { WORKER_SCRIPT } from "./worker-script.ts";

export interface GenerateCallbacks {
  onStatus?: (status: "loading-runtime" | "downloading-model" | "ready" | "generating") => void;
  onDownloadProgress?: (progress: number, file?: string) => void;
  onToken?: (token: string) => void;
  onDone?: (text: string) => void;
  onError?: (error: string) => void;
}

let instance: BrowserInferenceClient | null = null;

export class BrowserInferenceClient {
  private worker: Worker | null = null;
  private blobUrl: string | null = null;

  static getInstance(): BrowserInferenceClient {
    if (!instance) instance = new BrowserInferenceClient();
    return instance;
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;

    const blob = new Blob([WORKER_SCRIPT], { type: "application/javascript" });
    this.blobUrl = URL.createObjectURL(blob);
    this.worker = new Worker(this.blobUrl, { type: "module" });

    return this.worker;
  }

  generate(
    id: string,
    messages: Array<{ role: string; content: string }>,
    options: { maxNewTokens?: number; temperature?: number; systemPrompt?: string },
    callbacks: GenerateCallbacks,
  ): void {
    const worker = this.ensureWorker();

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      switch (msg.type) {
        case "status":
          callbacks.onStatus?.(msg.status);
          break;
        case "download-progress":
          callbacks.onDownloadProgress?.(msg.progress, msg.file);
          break;
        case "token":
          if (msg.id === id) callbacks.onToken?.(msg.token);
          break;
        case "done":
          if (msg.id === id) callbacks.onDone?.(msg.text);
          break;
        case "error":
          if (msg.id === id) callbacks.onError?.(msg.error);
          break;
      }
    };

    worker.onerror = (event) => {
      callbacks.onError?.(event.message || "Worker error");
    };

    const request: WorkerRequest = { type: "generate", id, messages, options };
    worker.postMessage(request);
  }

  stop(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    if (this.blobUrl) {
      URL.revokeObjectURL(this.blobUrl);
      this.blobUrl = null;
    }
  }
}
