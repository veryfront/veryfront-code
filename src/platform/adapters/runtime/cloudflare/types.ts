import type { WebSocketConnection } from "../../base.ts";

export interface CloudflareWebSocket extends WebSocketConnection {
  accept(options?: { allowHalfOpen?: boolean }): void;
}

export declare class WebSocketPair {
  0: CloudflareWebSocket;
  1: CloudflareWebSocket;
}

export interface CloudflareResponseInit extends ResponseInit {
  webSocket?: CloudflareWebSocket;
}

export interface CloudflareServerRuntime {
  createWebSocketPair(): { 0: CloudflareWebSocket; 1: CloudflareWebSocket };
  createResponse(init: CloudflareResponseInit): Response;
}

export type KVMetadata = Record<string, unknown>;

export interface KVListKey {
  name: string;
  expiration?: number;
  metadata?: KVMetadata;
}

export interface KVGetWithMetadataResult<T = string> {
  value: T | null;
  metadata: KVMetadata | null;
}

export interface KVListOptions {
  prefix?: string;
  limit?: number;
  cursor?: string;
}

export type KVListResult =
  | {
    keys: KVListKey[];
    list_complete: true;
    cursor?: string;
  }
  | {
    keys: KVListKey[];
    list_complete: false;
    cursor: string;
  };

export type KVValueType = "text" | "arrayBuffer";

export type KVValueForType<Type extends KVValueType> = Type extends "arrayBuffer" ? ArrayBuffer
  : string;

export interface KVGetOptions<Type extends KVValueType = KVValueType> {
  cacheTtl?: number;
  type?: Type;
}

export interface KVPutOptions {
  expiration?: number;
  expirationTtl?: number;
  metadata?: KVMetadata;
}

export interface KVNamespace {
  get<Type extends KVValueType = "text">(
    key: string,
    typeOrOptions?: Type | KVGetOptions<Type>,
  ): Promise<KVValueForType<Type> | null>;
  put(key: string, value: string | ArrayBuffer, options?: KVPutOptions): Promise<void>;
  delete(key: string): Promise<void>;
  list(options?: KVListOptions): Promise<KVListResult>;
  getWithMetadata<Type extends KVValueType = "text">(
    key: string,
    typeOrOptions?: Type | KVGetOptions<Type>,
  ): Promise<KVGetWithMetadataResult<KVValueForType<Type>>>;
}

export interface DurableObjectNamespace {
  [key: string]: unknown;
}

export interface R2Bucket {
  [key: string]: unknown;
}

export interface CloudflareEnv {
  readonly [key: string]: string | KVNamespace | DurableObjectNamespace | R2Bucket | unknown;
}
