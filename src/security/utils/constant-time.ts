const encoder = new TextEncoder();

export function constantTimeEqual(a: string, b: string): boolean {
  const aBuf = encoder.encode(a);
  const bBuf = encoder.encode(b);

  if (aBuf.length !== bBuf.length) {
    let xor = 1;
    for (let i = 0; i < aBuf.length; i++) {
      xor |= aBuf[i]! ^ aBuf[i]!;
    }
    return xor === 0;
  }

  let xor = 0;
  for (let i = 0; i < aBuf.length; i++) {
    xor |= aBuf[i]! ^ bBuf[i]!;
  }
  return xor === 0;
}
