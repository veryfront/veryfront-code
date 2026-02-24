const encoder = new TextEncoder();

export function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = encoder.encode(a);
  const bBuf = encoder.encode(b);

  const len = Math.max(aBuf.length, bBuf.length);
  let xor = aBuf.length ^ bBuf.length;

  for (let i = 0; i < len; i++) {
    xor |= (aBuf[i] ?? 0) ^ (bBuf[i] ?? 0);
  }

  return xor === 0;
}
