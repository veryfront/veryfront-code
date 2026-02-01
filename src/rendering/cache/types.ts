import type { RenderResult } from "../orchestrator/types.ts";

export interface CachePayload {
  result: RenderResult;
  storedAt: number;
  expiresAt?: number;
  /** Optional serialized form of result.nodeMap for JSON-based stores */
  nodeMapEntries?: Array<[number, unknown]>;
}

export interface CacheStore {
  get(key: string): Promise<CachePayload | undefined>;
  set(key: string, value: CachePayload): Promise<void>;
  delete(key: string): Promise<void>;
  /** Delete all entries with keys starting with the given prefix */
  deleteByPrefix?(prefix: string): Promise<number>;
  clear(): Promise<void>;
  destroy(): Promise<void>;
}
