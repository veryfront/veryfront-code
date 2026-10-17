import { replacePrivateRegExp } from "#veryfront/security/private-regexp.ts";

export function escapeHtml(value: string): string {
  let escaped = replacePrivateRegExp(/&/g, value, "&amp;");
  escaped = replacePrivateRegExp(/</g, escaped, "&lt;");
  escaped = replacePrivateRegExp(/>/g, escaped, "&gt;");
  escaped = replacePrivateRegExp(/"/g, escaped, "&quot;");
  return replacePrivateRegExp(/'/g, escaped, "&#39;");
}
