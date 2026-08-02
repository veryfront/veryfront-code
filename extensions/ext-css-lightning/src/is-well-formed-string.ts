/** Local UTF-16 well-formedness check for the extension's Node 18 package. */

const apply = Reflect.apply;
const stringCharCodeAt = String.prototype.charCodeAt;

export function isWellFormedString(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const codeUnit = apply(stringCharCodeAt, value, [index]) as number;
    if (codeUnit >= 0xD800 && codeUnit <= 0xDBFF) {
      index++;
      if (index >= value.length) return false;
      const trailingCodeUnit = apply(stringCharCodeAt, value, [index]) as number;
      if (trailingCodeUnit < 0xDC00 || trailingCodeUnit > 0xDFFF) return false;
    } else if (codeUnit >= 0xDC00 && codeUnit <= 0xDFFF) {
      return false;
    }
  }
  return true;
}
