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
