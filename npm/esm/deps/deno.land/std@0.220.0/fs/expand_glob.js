// Copyright 2018-2024 the Deno authors. All rights reserved. MIT license.
import * as dntShim from "../../../../_dnt.shims.js";
import { globToRegExp } from "../path/glob_to_regexp.js";
import { joinGlobs } from "../path/join_globs.js";
import { isGlob } from "../path/is_glob.js";
import { isAbsolute } from "../path/is_absolute.js";
import { resolve } from "../path/resolve.js";
import { SEPARATOR_PATTERN } from "../path/constants.js";
import { walk, walkSync } from "./walk.js";
import { assert } from "../assert/assert.js";
import { toPathString } from "./_to_path_string.js";
import { createWalkEntry, createWalkEntrySync, } from "./_create_walk_entry.js";
const isWindows = dntShim.Deno.build.os === "windows";
function split(path) {
    const s = SEPARATOR_PATTERN.source;
    const segments = path
        .replace(new RegExp(`^${s}|${s}$`, "g"), "")
        .split(SEPARATOR_PATTERN);
    const isAbsolute_ = isAbsolute(path);
    return {
        segments,
        isAbsolute: isAbsolute_,
        hasTrailingSep: !!path.match(new RegExp(`${s}$`)),
        winRoot: isWindows && isAbsolute_ ? segments.shift() : undefined,
    };
}
function throwUnlessNotFound(error) {
    if (!(error instanceof dntShim.Deno.errors.NotFound)) {
        throw error;
    }
}
function comparePath(a, b) {
    if (a.path < b.path)
        return -1;
    if (a.path > b.path)
        return 1;
    return 0;
}
/**
 * Expand the glob string from the specified `root` directory and yield each
 * result as a `WalkEntry` object.
 *
 * See [`globToRegExp()`](../path/glob.ts#globToRegExp) for details on supported
 * syntax.
 *
 * @example
 * ```ts
 * import { expandGlob } from "https://deno.land/std@$STD_VERSION/fs/expand_glob.ts";
 * for await (const file of expandGlob("**\/*.ts")) {
 *   console.log(file);
 * }
 * ```
 */
export async function* expandGlob(glob, { root, exclude = [], includeDirs = true, extended = true, globstar = true, caseInsensitive, followSymlinks, canonicalize, } = {}) {
    const { segments, isAbsolute: isGlobAbsolute, hasTrailingSep, winRoot, } = split(toPathString(glob));
    root ??= isGlobAbsolute ? winRoot ?? "/" : dntShim.Deno.cwd();
    const globOptions = { extended, globstar, caseInsensitive };
    const absRoot = isGlobAbsolute ? root : resolve(root); // root is always string here
    const resolveFromRoot = (path) => resolve(absRoot, path);
    const excludePatterns = exclude
        .map(resolveFromRoot)
        .map((s) => globToRegExp(s, globOptions));
    const shouldInclude = (path) => !excludePatterns.some((p) => !!path.match(p));
    let fixedRoot = isGlobAbsolute
        ? winRoot !== undefined ? winRoot : "/"
        : absRoot;
    while (segments.length > 0 && !isGlob(segments[0])) {
        const seg = segments.shift();
        assert(seg !== undefined);
        fixedRoot = joinGlobs([fixedRoot, seg], globOptions);
    }
    let fixedRootInfo;
    try {
        fixedRootInfo = await createWalkEntry(fixedRoot);
    }
    catch (error) {
        return throwUnlessNotFound(error);
    }
    async function* advanceMatch(walkInfo, globSegment) {
        if (!walkInfo.isDirectory) {
            return;
        }
        else if (globSegment === "..") {
            const parentPath = joinGlobs([walkInfo.path, ".."], globOptions);
            try {
                if (shouldInclude(parentPath)) {
                    return yield await createWalkEntry(parentPath);
                }
            }
            catch (error) {
                throwUnlessNotFound(error);
            }
            return;
        }
        else if (globSegment === "**") {
            return yield* walk(walkInfo.path, {
                skip: excludePatterns,
                maxDepth: globstar ? Infinity : 1,
                followSymlinks,
                canonicalize,
            });
        }
        const globPattern = globToRegExp(globSegment, globOptions);
        for await (const walkEntry of walk(walkInfo.path, {
            maxDepth: 1,
            skip: excludePatterns,
            followSymlinks,
        })) {
            if (walkEntry.path !== walkInfo.path &&
                walkEntry.name.match(globPattern)) {
                yield walkEntry;
            }
        }
    }
    let currentMatches = [fixedRootInfo];
    for (const segment of segments) {
        // Advancing the list of current matches may introduce duplicates, so we
        // pass everything through this Map.
        const nextMatchMap = new Map();
        await Promise.all(currentMatches.map(async (currentMatch) => {
            for await (const nextMatch of advanceMatch(currentMatch, segment)) {
                nextMatchMap.set(nextMatch.path, nextMatch);
            }
        }));
        currentMatches = [...nextMatchMap.values()].sort(comparePath);
    }
    if (hasTrailingSep) {
        currentMatches = currentMatches.filter((entry) => entry.isDirectory);
    }
    if (!includeDirs) {
        currentMatches = currentMatches.filter((entry) => !entry.isDirectory);
    }
    yield* currentMatches;
}
/**
 * Synchronous version of `expandGlob()`.
 *
 * @example
 * ```ts
 * import { expandGlobSync } from "https://deno.land/std@$STD_VERSION/fs/expand_glob.ts";
 * for (const file of expandGlobSync("**\/*.ts")) {
 *   console.log(file);
 * }
 * ```
 */
export function* expandGlobSync(glob, { root, exclude = [], includeDirs = true, extended = true, globstar = true, caseInsensitive, followSymlinks, canonicalize, } = {}) {
    const { segments, isAbsolute: isGlobAbsolute, hasTrailingSep, winRoot, } = split(toPathString(glob));
    root ??= isGlobAbsolute ? winRoot ?? "/" : dntShim.Deno.cwd();
    const globOptions = { extended, globstar, caseInsensitive };
    const absRoot = isGlobAbsolute ? root : resolve(root); // root is always string here
    const resolveFromRoot = (path) => resolve(absRoot, path);
    const excludePatterns = exclude
        .map(resolveFromRoot)
        .map((s) => globToRegExp(s, globOptions));
    const shouldInclude = (path) => !excludePatterns.some((p) => !!path.match(p));
    let fixedRoot = isGlobAbsolute
        ? winRoot !== undefined ? winRoot : "/"
        : absRoot;
    while (segments.length > 0 && !isGlob(segments[0])) {
        const seg = segments.shift();
        assert(seg !== undefined);
        fixedRoot = joinGlobs([fixedRoot, seg], globOptions);
    }
    let fixedRootInfo;
    try {
        fixedRootInfo = createWalkEntrySync(fixedRoot);
    }
    catch (error) {
        return throwUnlessNotFound(error);
    }
    function* advanceMatch(walkInfo, globSegment) {
        if (!walkInfo.isDirectory) {
            return;
        }
        else if (globSegment === "..") {
            const parentPath = joinGlobs([walkInfo.path, ".."], globOptions);
            try {
                if (shouldInclude(parentPath)) {
                    return yield createWalkEntrySync(parentPath);
                }
            }
            catch (error) {
                throwUnlessNotFound(error);
            }
            return;
        }
        else if (globSegment === "**") {
            return yield* walkSync(walkInfo.path, {
                skip: excludePatterns,
                maxDepth: globstar ? Infinity : 1,
                followSymlinks,
                canonicalize,
            });
        }
        const globPattern = globToRegExp(globSegment, globOptions);
        for (const walkEntry of walkSync(walkInfo.path, {
            maxDepth: 1,
            skip: excludePatterns,
            followSymlinks,
        })) {
            if (walkEntry.path !== walkInfo.path &&
                walkEntry.name.match(globPattern)) {
                yield walkEntry;
            }
        }
    }
    let currentMatches = [fixedRootInfo];
    for (const segment of segments) {
        // Advancing the list of current matches may introduce duplicates, so we
        // pass everything through this Map.
        const nextMatchMap = new Map();
        for (const currentMatch of currentMatches) {
            for (const nextMatch of advanceMatch(currentMatch, segment)) {
                nextMatchMap.set(nextMatch.path, nextMatch);
            }
        }
        currentMatches = [...nextMatchMap.values()].sort(comparePath);
    }
    if (hasTrailingSep) {
        currentMatches = currentMatches.filter((entry) => entry.isDirectory);
    }
    if (!includeDirs) {
        currentMatches = currentMatches.filter((entry) => !entry.isDirectory);
    }
    yield* currentMatches;
}
