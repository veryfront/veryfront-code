export interface CloudflareWebSocket extends WebSocket {
  accept(): void;
}

export declare class WebSocketPair {
  0: CloudflareWebSocket;
  1: CloudflareWebSocket;
}

export interface CloudflareResponseInit extends ResponseInit {
  webSocket?: CloudflareWebSocket;
}

export interface KVMetadata {
  [key: string]: string | number | boolean | null;
}

export interface KVListKey {
  name: string;
  expiration?: number;
  metadata?: KVMetadata;
}

export interface KVGetWithMetadataResult<T = string> {
  value: T | null;
  metadata: KVMetadata | null;
}

export interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { metadata?: KVMetadata }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: { prefix?: string; limit?: number }): Promise<{ keys: KVListKey[] }>;
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
