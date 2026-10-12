/**
 * Shard 1 of the compiled-binary e2e tests. The e2e:binary suite runs every
 * shard file in parallel; see selectCompiledBinaryE2EShard.
 */
import { selectCompiledBinaryE2EShard } from "./compiled-binary-e2e.test-helpers.ts";

selectCompiledBinaryE2EShard(1);
await import("./compiled-binary-e2e.suite.ts");
