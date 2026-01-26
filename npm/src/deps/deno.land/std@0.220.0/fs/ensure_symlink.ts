// Copyright 2018-2024 the Deno authors. All rights reserved. MIT license.
import * as dntShim from "../../../../_dnt.shims.js";

import { dirname } from "../path/dirname.js";
import { resolve } from "../path/resolve.js";
import { ensureDir, ensureDirSync } from "./ensure_dir.js";
import { getFileInfoType } from "./_get_file_info_type.js";
import { toPathString } from "./_to_path_string.js";

const isWindows = dntShim.Deno.build.os === "windows";

function resolveSymlinkTarget(target: string | URL, linkName: string | URL) {
  if (typeof target !== "string") return target; // URL is always absolute path
  if (typeof linkName === "string") {
    return resolve(dirname(linkName), target);
  } else {
    return new URL(target, linkName);
  }
}

/**
 * Ensures that the link exists, and points to a valid file.
 * If the directory structure does not exist, it is created.
 * If the link already exists, it is not modified but error is thrown if it is not point to the given target.
 * Requires the `--allow-read` and `--allow-write` flag.
 *
 * @param target the source file path
 * @param linkName the destination link path
 */
export async function ensureSymlink(
  target: string | URL,
  linkName: string | URL,
) {
  const targetRealPath = resolveSymlinkTarget(target, linkName);
  const srcStatInfo = await dntShim.Deno.lstat(targetRealPath);
  const srcFilePathType = getFileInfoType(srcStatInfo);

  await ensureDir(dirname(toPathString(linkName)));

  const options: dntShim.Deno.SymlinkOptions | undefined = isWindows
    ? {
      type: srcFilePathType === "dir" ? "dir" : "file",
    }
    : undefined;

  try {
    await dntShim.Deno.symlink(target, linkName, options);
  } catch (error) {
    if (!(error instanceof dntShim.Deno.errors.AlreadyExists)) {
      throw error;
    }
    const linkStatInfo = await dntShim.Deno.lstat(linkName);
    if (!linkStatInfo.isSymlink) {
      const type = getFileInfoType(linkStatInfo);
      throw new dntShim.Deno.errors.AlreadyExists(
        `A '${type}' already exists at the path: ${linkName}`,
      );
    }
    const linkPath = await dntShim.Deno.readLink(linkName);
    const linkRealPath = resolve(linkPath);
    if (linkRealPath !== targetRealPath) {
      throw new dntShim.Deno.errors.AlreadyExists(
        `A symlink targeting to an undesired path already exists: ${linkName} -> ${linkRealPath}`,
      );
    }
  }
}

/**
 * Ensures that the link exists, and points to a valid file.
 * If the directory structure does not exist, it is created.
 * If the link already exists, it is not modified but error is thrown if it is not point to the given target.
 * Requires the `--allow-read` and `--allow-write` flag.
 *
 * @param target the source file path
 * @param linkName the destination link path
 */
export function ensureSymlinkSync(
  target: string | URL,
  linkName: string | URL,
) {
  const targetRealPath = resolveSymlinkTarget(target, linkName);
  const srcStatInfo = dntShim.Deno.lstatSync(targetRealPath);
  const srcFilePathType = getFileInfoType(srcStatInfo);

  ensureDirSync(dirname(toPathString(linkName)));

  const options: dntShim.Deno.SymlinkOptions | undefined = isWindows
    ? {
      type: srcFilePathType === "dir" ? "dir" : "file",
    }
    : undefined;

  try {
    dntShim.Deno.symlinkSync(target, linkName, options);
  } catch (error) {
    if (!(error instanceof dntShim.Deno.errors.AlreadyExists)) {
      throw error;
    }
    const linkStatInfo = dntShim.Deno.lstatSync(linkName);
    if (!linkStatInfo.isSymlink) {
      const type = getFileInfoType(linkStatInfo);
      throw new dntShim.Deno.errors.AlreadyExists(
        `A '${type}' already exists at the path: ${linkName}`,
      );
    }
    const linkPath = dntShim.Deno.readLinkSync(linkName);
    const linkRealPath = resolve(linkPath);
    if (linkRealPath !== targetRealPath) {
      throw new dntShim.Deno.errors.AlreadyExists(
        `A symlink targeting to an undesired path already exists: ${linkName} -> ${linkRealPath}`,
      );
    }
  }
}
