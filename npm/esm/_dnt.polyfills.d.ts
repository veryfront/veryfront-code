declare global {
    interface ArrayConstructor {
        fromAsync<T>(iterableOrArrayLike: AsyncIterable<T> | Iterable<T | Promise<T>> | ArrayLike<T | Promise<T>>): Promise<T[]>;
        fromAsync<T, U>(iterableOrArrayLike: AsyncIterable<T> | Iterable<T> | ArrayLike<T>, mapFn: (value: Awaited<T>) => U, thisArg?: any): Promise<Awaited<U>[]>;
    }
}
export {}; /**
 * Based on [import-meta-ponyfill](https://github.com/gaubee/import-meta-ponyfill),
 * but instead of using npm to install additional dependencies,
 * this approach manually consolidates cjs/mjs/d.ts into a single file.
 *
 * Note that this code might be imported multiple times
 * (for example, both dnt.test.polyfills.ts and dnt.polyfills.ts contain this code;
 *  or Node.js might dynamically clear the cache and then force a require).
 * Therefore, it's important to avoid redundant writes to global objects.
 * Additionally, consider that commonjs is used alongside esm,
 * so the two ponyfill functions are stored independently in two separate global objects.
 */
import { createRequire } from "node:module";
import { type URL } from "node:url";
declare global {
    interface ImportMeta {
        /** A string representation of the fully qualified module URL. When the
         * module is loaded locally, the value will be a file URL (e.g.
         * `file:///path/module.ts`).
         *
         * You can also parse the string as a URL to determine more information about
         * how the current module was loaded. For example to determine if a module was
         * local or not:
         *
         * ```ts
         * const url = new URL(import.meta.url);
         * if (url.protocol === "file:") {
         *   console.log("this module was loaded locally");
         * }
         * ```
         */
        url: string;
        /**
         * A function that returns resolved specifier as if it would be imported
         * using `import(specifier)`.
         *
         * ```ts
         * console.log(import.meta.resolve("./foo.js"));
         * // file:///dev/foo.js
         * ```
         *
         * @param specifier The module specifier to resolve relative to `parent`.
         * @param parent The absolute parent module URL to resolve from.
         * @returns The absolute (`file:`) URL string for the resolved module.
         */
        resolve(specifier: string, parent?: string | URL | undefined): string;
        /** A flag that indicates if the current module is the main module that was
         * called when starting the program under Deno.
         *
         * ```ts
         * if (import.meta.main) {
         *   // this was loaded as the main module, maybe do some bootstrapping
         * }
         * ```
         */
        main: boolean;
        /** The absolute path of the current module.
         *
         * This property is only provided for local modules (ie. using `file://` URLs).
         *
         * Example:
         * ```
         * // Unix
         * console.log(import.meta.filename); // /home/alice/my_module.ts
         *
         * // Windows
         * console.log(import.meta.filename); // C:\alice\my_module.ts
         * ```
         */
        filename: string;
        /** The absolute path of the directory containing the current module.
         *
         * This property is only provided for local modules (ie. using `file://` URLs).
         *
         * * Example:
         * ```
         * // Unix
         * console.log(import.meta.dirname); // /home/alice
         *
         * // Windows
         * console.log(import.meta.dirname); // C:\alice
         * ```
         */
        dirname: string;
    }
}
type NodeRequest = ReturnType<typeof createRequire>;
type NodeModule = NonNullable<NodeRequest["main"]>;
interface ImportMetaPonyfillCommonjs {
    (require: NodeRequest, module: NodeModule): ImportMeta;
}
interface ImportMetaPonyfillEsmodule {
    (importMeta: ImportMeta): ImportMeta;
}
interface ImportMetaPonyfill extends ImportMetaPonyfillCommonjs, ImportMetaPonyfillEsmodule {
}
export declare let import_meta_ponyfill_commonjs: ImportMetaPonyfillCommonjs;
export declare let import_meta_ponyfill_esmodule: ImportMetaPonyfillEsmodule;
export declare let import_meta_ponyfill: ImportMetaPonyfill;
declare global {
    interface Array<T> {
        /**
         * Returns the value of the last element in the array where predicate is true, and undefined
         * otherwise.
         * @param predicate find calls predicate once for each element of the array, in ascending
         * order, until it finds one where predicate returns true. If such an element is found, find
         * immediately returns that element value. Otherwise, find returns undefined.
         * @param thisArg If provided, it will be used as the this value for each invocation of
         * predicate. If it is not provided, undefined is used instead.
         */
        findLast<S extends T>(predicate: (this: void, value: T, index: number, obj: T[]) => value is S, thisArg?: any): S | undefined;
        findLast(predicate: (value: T, index: number, obj: T[]) => unknown, thisArg?: any): T | undefined;
        /**
         * Returns the index of the last element in the array where predicate is true, and -1
         * otherwise.
         * @param predicate find calls predicate once for each element of the array, in ascending
         * order, until it finds one where predicate returns true. If such an element is found,
         * findIndex immediately returns that element index. Otherwise, findIndex returns -1.
         * @param thisArg If provided, it will be used as the this value for each invocation of
         * predicate. If it is not provided, undefined is used instead.
         */
        findLastIndex(predicate: (value: T, index: number, obj: T[]) => unknown, thisArg?: any): number;
    }
    interface Uint8Array {
        /**
         * Returns the value of the last element in the array where predicate is true, and undefined
         * otherwise.
         * @param predicate findLast calls predicate once for each element of the array, in descending
         * order, until it finds one where predicate returns true. If such an element is found, findLast
         * immediately returns that element value. Otherwise, findLast returns undefined.
         * @param thisArg If provided, it will be used as the this value for each invocation of
         * predicate. If it is not provided, undefined is used instead.
         */
        findLast<S extends number>(predicate: (value: number, index: number, array: Uint8Array) => value is S, thisArg?: any): S | undefined;
        findLast(predicate: (value: number, index: number, array: Uint8Array) => unknown, thisArg?: any): number | undefined;
        /**
         * Returns the index of the last element in the array where predicate is true, and -1
         * otherwise.
         * @param predicate findLastIndex calls predicate once for each element of the array, in descending
         * order, until it finds one where predicate returns true. If such an element is found,
         * findLastIndex immediately returns that element index. Otherwise, findLastIndex returns -1.
         * @param thisArg If provided, it will be used as the this value for each invocation of
         * predicate. If it is not provided, undefined is used instead.
         */
        findLastIndex(predicate: (value: number, index: number, array: Uint8Array) => unknown, thisArg?: any): number;
    }
}
export {};
declare global {
    interface Error {
        cause?: unknown;
    }
}
export {};
declare global {
    interface Object {
        /**
         * Determines whether an object has a property with the specified name.
         * @param o An object.
         * @param v A property name.
         */
        hasOwn(o: object, v: PropertyKey): boolean;
    }
}
export {};
//# sourceMappingURL=_dnt.polyfills.d.ts.map