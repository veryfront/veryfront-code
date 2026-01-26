/**
 * Consolidated asset utility functions for build pipeline
 * Merges CSS, Image, and Tailwind processor utilities
 */
import { basename, dirname, extname, join } from "../../platform/compat/path/index.js";
import { walk } from "../../../deps/deno.land/std@0.220.0/fs/mod.js";
import { logger } from "../../utils/index.js";
import { createError, toError } from "../../errors/veryfront-error.js";
import { getOptimizedImageFormat, isImageFile as checkIsImage, } from "./file-types.js";
export const CSS_EXTENSIONS = [".css", ".scss", ".sass", ".less"];
export async function findCSSFiles(dir) {
    const cssFiles = [];
    try {
        for await (const entry of walk(dir, {
            includeDirs: false,
            followSymlinks: false,
            exts: ["css"],
        })) {
            cssFiles.push(entry.path);
        }
    }
    catch (error) {
        logger.warn(`Failed to read directory ${dir}`, {
            error: error instanceof Error ? error.message : String(error),
        });
    }
    return cssFiles;
}
export async function globFiles(pattern) {
    const [baseDirPart, filePatternPart] = pattern.split("**/");
    const baseDir = baseDirPart || ".";
    const filePattern = filePatternPart || pattern;
    const files = [];
    try {
        for await (const entry of walk(baseDir, {
            includeDirs: false,
            followSymlinks: false,
        })) {
            if (!filePattern) {
                files.push(entry.path);
                continue;
            }
            const match = filePattern.replace("*", "");
            if (entry.name.includes(match))
                files.push(entry.path);
        }
    }
    catch (error) {
        logger.warn(`Failed to glob files with pattern ${pattern}`, {
            error: error instanceof Error ? error.message : String(error),
        });
    }
    return files;
}
export function isPseudoSelector(selector) {
    return selector.includes(":");
}
export function getStandardPseudoSelectors() {
    return [
        ":hover",
        ":focus",
        ":active",
        ":visited",
        ":disabled",
        ":checked",
        "::before",
        "::after",
        ":first-child",
        ":last-child",
        ":nth-child",
        ":focus-visible",
        ":focus-within",
    ];
}
export function getVariantPath(outputDir, relPath, format, size) {
    const dir = dirname(relPath);
    const name = basename(relPath, extname(relPath));
    return join(outputDir, dir, `${name}-${size}w.${format}`);
}
export function generateSrcSet(_imagePath, metadata, outputDir, format) {
    const targetFormat = format ?? metadata.defaultFormat;
    const variants = metadata.variants.filter((v) => v.format === targetFormat);
    return variants.map((v) => `/${join(outputDir, v.path)} ${v.width}w`).join(", ");
}
export function calculateAspectRatio(width, height) {
    return width && height ? width / height : 1;
}
export const getOptimizedFormat = getOptimizedImageFormat;
export const isImageFile = checkIsImage;
export function getImageDimensions(metadata) {
    const original = metadata.variants.find((v) => v.format === metadata.defaultFormat) ??
        metadata.variants[0];
    if (!original) {
        throw toError(createError({
            type: "build",
            message: "No image variants found in metadata",
        }));
    }
    return { width: original.width, height: original.height };
}
