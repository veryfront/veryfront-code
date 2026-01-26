import { createError, toError } from "../../errors/veryfront-error.js";
export class CompilerService {
    _compileMDX = null;
    setCompileMDX(fn) {
        this._compileMDX = fn;
    }
    compileMDX(content, frontmatter, filePath) {
        const compile = this._compileMDX;
        if (!compile) {
            throw toError(createError({
                type: "render",
                message: "CompilerService: compileMDX not initialized",
            }));
        }
        return compile(content, frontmatter, filePath);
    }
    getCompileFunction() {
        return this.compileMDX.bind(this);
    }
}
