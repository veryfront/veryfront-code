/**
 * Install Veryfront test isolation before test modules and their dependencies.
 *
 * Use this module with `deno test --preload=src/testing/preload.ts` when test
 * dependencies can mutate process environment variables during evaluation.
 *
 * @module testing/preload
 */

import "./bdd.ts";
import "../schemas/_test-setup.ts";
import { __installUnpinnedHostTransportForTests } from "../security/http/outbound-fetch.ts";

// Tests that genuinely reach the network use the plain host transport rather
// than Deno's pinned SOCKS client, which holds connections open past the end of
// a test. Installing it here keeps the security module to a single rule and
// leaves the test-only decision somewhere a reader can find it.
__installUnpinnedHostTransportForTests();
