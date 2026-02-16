/**
 * Worker ↔ main thread message protocol for browser-side inference.
 */

export interface WorkerGenerateRequest {
  type: "generate";
  id: string;
  messages: Array<{ role: string; content: string }>;
  options?: {
    maxNewTokens?: number;
    temperature?: number;
    systemPrompt?: string;
  };
}

export type WorkerRequest = WorkerGenerateRequest;

export interface WorkerStatusResponse {
  type: "status";
  status: "loading-runtime" | "downloading-model" | "ready" | "generating";
}

export interface WorkerDownloadProgressResponse {
  type: "download-progress";
  progress: number; // 0–100
  file?: string;
}

export interface WorkerTokenResponse {
  type: "token";
  id: string;
  token: string;
}

export interface WorkerDoneResponse {
  type: "done";
  id: string;
  text: string;
}

export interface WorkerErrorResponse {
  type: "error";
  id: string;
  error: string;
}

export type WorkerResponse =
  | WorkerStatusResponse
  | WorkerDownloadProgressResponse
  | WorkerTokenResponse
  | WorkerDoneResponse
  | WorkerErrorResponse;
