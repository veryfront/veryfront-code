// One release-wide metadata counter shared by isolated publisher processes.
// Native advisory locking serializes updates without polling or retry loops.
const [operation, path, amountText = "0", limitText = "0"] = Deno.args;
const amount = Number(amountText), limit = Number(limitText);
if (
  !["read", "charge", "reserve"].includes(operation) || !path ||
  !Number.isSafeInteger(amount) || amount < 0 || !Number.isSafeInteger(limit) || limit < 0
) {
  throw new Error("Invalid metadata budget operation");
}
const file = await Deno.open(path, { read: true, write: true });
try {
  await file.lock(true);
  const bytes = new Uint8Array((await file.stat()).size);
  let offset = 0;
  while (offset < bytes.length) {
    const size = await file.read(bytes.subarray(offset));
    if (size === null) throw new Error("Incomplete metadata budget state");
    offset += size;
  }
  let { spent } = JSON.parse(new TextDecoder().decode(bytes));
  if (!Number.isSafeInteger(spent) || spent < 0) throw new Error("Invalid metadata budget state");
  if (operation === "reserve" && (spent >= limit || amount > limit - spent)) {
    Deno.exitCode = 2;
  } else if (operation !== "read") {
    spent += amount;
    if (!Number.isSafeInteger(spent)) throw new Error("Metadata budget overflow");
    await file.truncate(0);
    await file.seek(0, Deno.SeekMode.Start);
    const result = new TextEncoder().encode(JSON.stringify({ spent }));
    offset = 0;
    while (offset < result.length) offset += await file.write(result.subarray(offset));
  }
  console.log(spent);
} finally {
  file.close();
}
