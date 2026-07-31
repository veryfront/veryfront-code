import { NodeCompatibleFileSystemAdapter } from "../shared/node-filesystem-adapter.ts";
import { markNativeFileSystemAdapter } from "../../native-file-system-provenance.ts";
import { serverLogger } from "#veryfront/utils";

/** Node.js filesystem adapter. */
export class NodeFileSystemAdapter extends NodeCompatibleFileSystemAdapter {
  constructor() {
    super(serverLogger);
    if (new.target === NodeFileSystemAdapter) {
      markNativeFileSystemAdapter(this);
    }
  }

  override async exists(path: string): Promise<boolean> {
    try {
      return await super.exists(path);
    } catch (error) {
      serverLogger.debug(`File access check failed for ${path}:`, { error });
      throw error;
    }
  }
}
