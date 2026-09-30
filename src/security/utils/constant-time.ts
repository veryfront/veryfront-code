// Capture encoding before application code can replace the shared prototype.
const encoder = new TextEncoder();
const encode = encoder.encode.bind(encoder);

export function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = encode(a);
  const bBuf = encode(b);

  const len = Math.max(aBuf.length, bBuf.length);
  let xor = aBuf.length ^ bBuf.length;

  // Pad out-of-range positions with 0xff (not 0x00) so a padded slot can
  // never coincide with a real 0x00 byte on the other side and read as a
  // match. Matches the CSRF comparison in src/security/csrf/helpers.ts.
  for (let i = 0; i < len; i++) {
    xor |= (aBuf[i] ?? 0xff) ^ (bBuf[i] ?? 0xff);
  }

  return xor === 0;
}
