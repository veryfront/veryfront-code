import {
  NodeCompatibleFileSystemAdapter,
  type NodeFileSystemCapabilityOptions,
} from "../shared/node-filesystem-adapter.ts";
import {
  isDirectConstruction,
  markNativeFileSystemAdapter,
} from "../../native-file-system-provenance.ts";
import type { BunNamespace } from "./types.ts";
import { getBunRuntime } from "./types.ts";
import { NOT_SUPPORTED } from "#veryfront/errors/error-registry/general.ts";
import { serverLogger } from "#veryfront/utils";

export type BunFileSystemRuntime = Pick<BunNamespace, "file" | "write">;

/**
 * Bun-native fast paths for file contents. Directory, metadata, mutation, and
 * watcher operations intentionally reuse Bun's documented Node-compatible
 * filesystem APIs through the shared Node-compatible implementation.
 */
export class BunFileSystemAdapter extends NodeCompatibleFileSystemAdapter {
  constructor(
    private readonly runtime: BunFileSystemRuntime | null = getBunRuntime() ?? null,
    options: NodeFileSystemCapabilityOptions = {},
  ) {
    super(serverLogger, { ...options, windowsSnapshotIdentity: true });
    if (isDirectConstruction(this, BunFileSystemAdapter)) {
      markNativeFileSystemAdapter(this);
    }
  }

  override async readFile(path: string): Promise<string> {
    return await this.requireRuntime("readFile").file(path).text();
  }

  override async readFileBytes(path: string): Promise<Uint8Array> {
    const file = this.requireRuntime("readFileBytes").file(path);
    if (file.bytes) return await file.bytes();
    return new Uint8Array(await file.arrayBuffer());
  }

  override async writeFile(path: string, content: string): Promise<void> {
    await this.requireRuntime("writeFile").write(path, content);
  }

  override async writeFileBytes(path: string, content: Uint8Array): Promise<void> {
    await this.requireRuntime("writeFileBytes").write(path, content);
  }

  private requireRuntime(operation: string): BunFileSystemRuntime {
    if (this.runtime) return this.runtime;
    throw NOT_SUPPORTED.create({
      detail: `BunFileSystemAdapter.${operation}() can only be used in the Bun runtime`,
      context: { platform: "bun", operation },
    });
  }
}
