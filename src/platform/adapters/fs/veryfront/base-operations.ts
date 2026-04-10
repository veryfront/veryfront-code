import type { VeryfrontApiClient } from "../../veryfront-api-client/index.ts";
import { FileCache } from "../cache/file-cache.ts";
import type { ContentContextProvider } from "./file-list-access.ts";
import { PathNormalizer } from "./path-normalizer.ts";

export class VeryfrontOperationsBase {
  constructor(
    protected readonly client: VeryfrontApiClient,
    protected readonly cache: FileCache,
    protected readonly normalizer: PathNormalizer,
    protected readonly contextProvider?: ContentContextProvider,
  ) {}
}
