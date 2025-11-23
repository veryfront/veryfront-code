import type { RenderResult } from "../orchestrator/types.ts";

export interface CachePayload {
  result: RenderResult;
  storedAt: number;
  expiresAt?: number;
}

export interface CacheStore {
  get(key: string): Promise<CachePayload | undefined>;
  set(key: string, value: CachePayload): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  destroy(): Promise<void>;
}
