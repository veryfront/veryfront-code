const policy = await import("./private-framework-module-policy.ts");

const originalDecodeURIComponent = globalThis.decodeURIComponent;
const originalEndsWith = String.prototype.endsWith;
const originalJoin = Array.prototype.join;
const originalReplaceAll = String.prototype.replaceAll;
const originalSlice = String.prototype.slice;
const originalSome = Array.prototype.some;
const originalSplit = String.prototype.split;
const originalStartsWith = String.prototype.startsWith;
const originalToLowerCase = String.prototype.toLowerCase;

try {
  globalThis.decodeURIComponent = ((value: string) => value) as typeof decodeURIComponent;
  String.prototype.endsWith = () => false;
  Array.prototype.join = () => "public/module.ts";
  String.prototype.replaceAll = function () {
    return String(this);
  };
  String.prototype.slice = function () {
    return String(this);
  };
  Array.prototype.some = () => false;
  String.prototype.split = function () {
    return [String(this)];
  };
  String.prototype.startsWith = () => false;
  String.prototype.toLowerCase = function () {
    return String(this);
  };

  const encodedPrivatePath =
    "/_vf_modules/_veryfront/agent/hosted%252Finternal%252Fcontrol-plane-mcp-source.js";
  console.log(JSON.stringify({
    canonical: policy.canonicalizeFrameworkModulePath(encodedPrivatePath),
    private: policy.isPrivateFrameworkModulePath(encodedPrivatePath),
  }));
} finally {
  globalThis.decodeURIComponent = originalDecodeURIComponent;
  String.prototype.endsWith = originalEndsWith;
  Array.prototype.join = originalJoin;
  String.prototype.replaceAll = originalReplaceAll;
  String.prototype.slice = originalSlice;
  Array.prototype.some = originalSome;
  String.prototype.split = originalSplit;
  String.prototype.startsWith = originalStartsWith;
  String.prototype.toLowerCase = originalToLowerCase;
}
