/**
 * Test-environment contract registration.
 *
 * Side-effect import: registers the default Bundler and ModuleLexer
 * implementations from `@veryfront/ext-esbuild` so integration tests that
 * exercise bootstrap/build paths can resolve those contracts without each
 * test having to wire it up.
 *
 * Mirrors `src/testing/init.ts` (used by unit tests) for the integration suite.
 *
 * @module
 */

import { EsbuildBundler, EsModuleLexer } from "@veryfront/ext-esbuild";
import { register, tryResolve } from "../../src/extensions/contracts.ts";

if (!tryResolve("Bundler")) register("Bundler", new EsbuildBundler());
if (!tryResolve("ModuleLexer")) register("ModuleLexer", new EsModuleLexer());
