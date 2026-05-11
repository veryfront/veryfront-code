/**
 * Test-environment contract registration for the ext-tailwind workspace.
 *
 * Side-effect import: registers the default Bundler and ModuleLexer
 * implementations so extension tests that exercise framework code can resolve
 * those contracts when run from the workspace package.
 *
 * @module
 */

import { EsbuildBundler, EsModuleLexer } from "@veryfront/ext-bundler-esbuild";
import { register, tryResolve } from "../../../src/extensions/contracts.ts";

if (!tryResolve("Bundler")) register("Bundler", new EsbuildBundler());
if (!tryResolve("ModuleLexer")) register("ModuleLexer", new EsModuleLexer());
