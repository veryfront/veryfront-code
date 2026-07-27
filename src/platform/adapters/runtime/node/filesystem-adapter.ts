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
}
