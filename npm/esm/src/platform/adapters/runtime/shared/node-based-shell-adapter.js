import { createError, toError } from "../../../../errors/index.js";
import * as fs from "node:fs";
export class NodeBasedShellAdapter {
    statSync(path) {
        try {
            const stat = fs.statSync(path);
            return { isFile: stat.isFile(), isDirectory: stat.isDirectory() };
        }
        catch (error) {
            throw toError(createError({
                type: "file",
                message: `Failed to stat file: ${error}`,
            }));
        }
    }
    readFileSync(path) {
        try {
            return fs.readFileSync(path, "utf-8");
        }
        catch (error) {
            throw toError(createError({
                type: "file",
                message: `Failed to read file: ${error}`,
            }));
        }
    }
}
