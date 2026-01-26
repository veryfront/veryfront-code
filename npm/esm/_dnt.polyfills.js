// From https://github.com/es-shims/array-from-async/blob/4a5ff83947b861f35b380d5d4f20da2f07698638/index.mjs
// Tried to have dnt depend on the package instead, but it distributes as an
// ES module, so doesn't work with CommonJS.
//
// Code below:
//
// Copyright 2021 J. S. Choi
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions
// are met:
//
// 1. Redistributions of source code must retain the above copyright
//    notice, this list of conditions and the following disclaimer.
//
// 2. Redistributions in binary form must reproduce the above copyright
//    notice, this list of conditions and the following disclaimer in the
//    documentation and/or other materials provided with the distribution.
//
// 3. Neither the name of the copyright holder nor the names of its
//    contributors may be used to endorse or promote products derived from
//    this software without specific prior written permission.
//
// **This software is provided by the copyright holders and contributors
// "as is" and any express or implied warranties, including, but not
// limited to, the implied warranties of merchantability and fitness for a
// particular purpose are disclaimed. In no event shall the copyright
// holder or contributors be liable for any direct, indirect, incidental,
// special, exemplary, or consequential damages (including, but not limited
// to, procurement of substitute goods or services; loss of use, data, or
// profits; or business interruption) however caused and on any theory of
// liability, whether in contract, strict liability, or tort (including
// negligence or otherwise) arising in any way out of the use of this
// software, even if advised of the possibility of such damage.**
const { MAX_SAFE_INTEGER } = Number;
const iteratorSymbol = Symbol.iterator;
const asyncIteratorSymbol = Symbol.asyncIterator;
const IntrinsicArray = Array;
const tooLongErrorMessage = 'Input is too long and exceeded Number.MAX_SAFE_INTEGER times.';
function isConstructor(obj) {
    if (obj != null) {
        const prox = new Proxy(obj, {
            construct() {
                return prox;
            },
        });
        try {
            new prox;
            return true;
        }
        catch (err) {
            return false;
        }
    }
    else {
        return false;
    }
}
async function fromAsync(items, mapfn, thisArg) {
    const itemsAreIterable = (asyncIteratorSymbol in items ||
        iteratorSymbol in items);
    if (itemsAreIterable) {
        const result = isConstructor(this)
            ? new this
            : IntrinsicArray(0);
        let i = 0;
        for await (const v of items) {
            if (i > MAX_SAFE_INTEGER) {
                throw TypeError(tooLongErrorMessage);
            }
            else if (mapfn) {
                result[i] = await mapfn.call(thisArg, v, i);
            }
            else {
                result[i] = v;
            }
            i++;
        }
        result.length = i;
        return result;
    }
    else {
        // In this case, the items are assumed to be an arraylike object with
        // a length property and integer properties for each element.
        const { length } = items;
        const result = isConstructor(this)
            ? new this(length)
            : IntrinsicArray(length);
        let i = 0;
        while (i < length) {
            if (i > MAX_SAFE_INTEGER) {
                throw TypeError(tooLongErrorMessage);
            }
            const v = await items[i];
            if (mapfn) {
                result[i] = await mapfn.call(thisArg, v, i);
            }
            else {
                result[i] = v;
            }
            i++;
        }
        result.length = i;
        return result;
    }
}
if (!Array.fromAsync) {
    Array.fromAsync = fromAsync;
}
//@ts-ignore
import { createRequire } from "node:module";
//@ts-ignore
import { fileURLToPath, pathToFileURL } from "node:url";
//@ts-ignore
import { dirname } from "node:path";
const defineGlobalPonyfill = (symbolFor, fn) => {
    if (!Reflect.has(globalThis, Symbol.for(symbolFor))) {
        Object.defineProperty(globalThis, Symbol.for(symbolFor), {
            configurable: true,
            get() {
                return fn;
            },
        });
    }
};
export let import_meta_ponyfill_commonjs = (Reflect.get(globalThis, Symbol.for("import-meta-ponyfill-commonjs")) ??
    (() => {
        const moduleImportMetaWM = new WeakMap();
        return (require, module) => {
            let importMetaCache = moduleImportMetaWM.get(module);
            if (importMetaCache == null) {
                const importMeta = Object.assign(Object.create(null), {
                    url: pathToFileURL(module.filename).href,
                    main: require.main == module,
                    resolve: (specifier, parentURL = importMeta.url) => {
                        return pathToFileURL((importMeta.url === parentURL
                            ? require
                            : createRequire(parentURL))
                            .resolve(specifier)).href;
                    },
                    filename: module.filename,
                    dirname: module.path,
                });
                moduleImportMetaWM.set(module, importMeta);
                importMetaCache = importMeta;
            }
            return importMetaCache;
        };
    })());
defineGlobalPonyfill("import-meta-ponyfill-commonjs", import_meta_ponyfill_commonjs);
export let import_meta_ponyfill_esmodule = (Reflect.get(globalThis, Symbol.for("import-meta-ponyfill-esmodule")) ??
    ((importMeta) => {
        const resolveFunStr = String(importMeta.resolve);
        const shimWs = new WeakSet();
        //@ts-ignore
        const mainUrl = ("file:///" + (process.argv[1] ?? "").replace(/\\/g, "/"))
            .replace(/\/{3,}/, "///");
        const commonShim = (importMeta) => {
            if (typeof importMeta.main !== "boolean") {
                importMeta.main = importMeta.url === mainUrl;
            }
            if (typeof importMeta.filename !== "string") {
                importMeta.filename = fileURLToPath(importMeta.url);
                importMeta.dirname = dirname(importMeta.filename);
            }
        };
        if (
        // v16.2.0+, v14.18.0+: Add support for WHATWG URL object to parentURL parameter.
        resolveFunStr === "undefined" ||
            // v20.0.0+, v18.19.0+"" This API now returns a string synchronously instead of a Promise.
            resolveFunStr.startsWith("async")
        // enable by --experimental-import-meta-resolve flag
        ) {
            import_meta_ponyfill_esmodule = (importMeta) => {
                if (!shimWs.has(importMeta)) {
                    shimWs.add(importMeta);
                    const importMetaUrlRequire = {
                        url: importMeta.url,
                        require: createRequire(importMeta.url),
                    };
                    importMeta.resolve = function resolve(specifier, parentURL = importMeta.url) {
                        return pathToFileURL((importMetaUrlRequire.url === parentURL
                            ? importMetaUrlRequire.require
                            : createRequire(parentURL)).resolve(specifier)).href;
                    };
                    commonShim(importMeta);
                }
                return importMeta;
            };
        }
        else {
            /// native support
            import_meta_ponyfill_esmodule = (importMeta) => {
                if (!shimWs.has(importMeta)) {
                    shimWs.add(importMeta);
                    commonShim(importMeta);
                }
                return importMeta;
            };
        }
        return import_meta_ponyfill_esmodule(importMeta);
    }));
defineGlobalPonyfill("import-meta-ponyfill-esmodule", import_meta_ponyfill_esmodule);
export let import_meta_ponyfill = ((...args) => {
    const _MODULE = (() => {
        if (typeof require === "function" && typeof module === "object") {
            return "commonjs";
        }
        else {
            // eval("typeof import.meta");
            return "esmodule";
        }
    })();
    if (_MODULE === "commonjs") {
        //@ts-ignore
        import_meta_ponyfill = (r, m) => import_meta_ponyfill_commonjs(r, m);
    }
    else {
        //@ts-ignore
        import_meta_ponyfill = (im) => import_meta_ponyfill_esmodule(im);
    }
    //@ts-ignore
    return import_meta_ponyfill(...args);
});
function findLastIndex(self, callbackfn, that) {
    const boundFunc = that === undefined ? callbackfn : callbackfn.bind(that);
    let index = self.length - 1;
    while (index >= 0) {
        const result = boundFunc(self[index], index, self);
        if (result) {
            return index;
        }
        index--;
    }
    return -1;
}
function findLast(self, callbackfn, that) {
    const index = self.findLastIndex(callbackfn, that);
    return index === -1 ? undefined : self[index];
}
if (!Array.prototype.findLastIndex) {
    Array.prototype.findLastIndex = function (callbackfn, that) {
        return findLastIndex(this, callbackfn, that);
    };
}
if (!Array.prototype.findLast) {
    Array.prototype.findLast = function (callbackfn, that) {
        return findLast(this, callbackfn, that);
    };
}
if (!Uint8Array.prototype.findLastIndex) {
    Uint8Array.prototype.findLastIndex = function (callbackfn, that) {
        return findLastIndex(this, callbackfn, that);
    };
}
if (!Uint8Array.prototype.findLast) {
    Uint8Array.prototype.findLast = function (callbackfn, that) {
        return findLast(this, callbackfn, that);
    };
}
// https://github.com/tc39/proposal-accessible-object-hasownproperty/blob/main/polyfill.js
if (!Object.hasOwn) {
    Object.defineProperty(Object, "hasOwn", {
        value: function (object, property) {
            if (object == null) {
                throw new TypeError("Cannot convert undefined or null to object");
            }
            return Object.prototype.hasOwnProperty.call(Object(object), property);
        },
        configurable: true,
        enumerable: false,
        writable: true,
    });
}
