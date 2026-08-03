export interface CloudflareWebSocket extends WebSocket {
  accept(options?: { allowHalfOpen?: boolean }): void;
}

export declare class WebSocketPair {
  0: CloudflareWebSocket;
  1: CloudflareWebSocket;
}

export interface CloudflareResponseInit extends ResponseInit {
  webSocket?: CloudflareWebSocket;
}

export type KVMetadataValue =
  | string
  | number
  | boolean
  | null
  | KVMetadataValue[]
  | { [key: string]: KVMetadataValue };

export interface KVMetadata {
  [key: string]: KVMetadataValue;
}

export interface KVListKey {
  name: string;
  expiration?: number;
  metadata?: KVMetadata;
}

export interface KVListOptions {
  prefix?: string;
  limit?: number;
  cursor?: string;
}

export interface KVListResult {
  keys: KVListKey[];
  list_complete: boolean;
  cursor: string;
}

export interface KVGetWithMetadataResult<T = string> {
  value: T | null;
  metadata: KVMetadata | null;
}

export interface KVNamespace {
  get(
    key: string,
    type?: "text" | "arrayBuffer" | "stream",
  ): Promise<string | ArrayBuffer | ReadableStream<Uint8Array> | null>;
  put(
    key: string,
    value: string | ArrayBuffer | ArrayBufferView,
    options?: { metadata?: KVMetadata },
  ): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: KVListOptions): Promise<KVListResult>;
  getWithMetadata(key: string): Promise<KVGetWithMetadataResult>;
}

export interface DurableObjectNamespace {
  [key: string]: unknown;
}

export interface R2Bucket {
  [key: string]: unknown;
}

export interface CloudflareEnv {
  [key: string]: string | KVNamespace | DurableObjectNamespace | R2Bucket | unknown;
}
