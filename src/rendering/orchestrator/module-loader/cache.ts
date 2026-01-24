const HEX_CHARS = "0123456789abcdef";

export async function generateHash(str: string): Promise<string> {
  const data = new TextEncoder().encode(str);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(hashBuffer);

  let hex = "";
  for (let i = 0; i < 8; i++) {
    const byte = bytes[i]!;
    hex += HEX_CHARS.charAt(byte >> 4) + HEX_CHARS.charAt(byte & 0xf);
  }
  return hex;
}

export function createModuleCache(): Map<string, string> {
  return new Map();
}

export function createEsmCache(): Map<string, string> {
  return new Map();
}
