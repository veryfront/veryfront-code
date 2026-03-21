import { createHash } from "node:crypto";
import { createReadStream, existsSync, unlinkSync } from "node:fs";
import https from "node:https";

export function computeFileHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

export function downloadText(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    function follow(currentUrl, redirectCount) {
      if (redirectCount > maxRedirects) {
        return reject(new Error("Too many redirects"));
      }
      let settled = false;
      https.get(currentUrl, (response) => {
        const { statusCode = 0, headers } = response;
        if (statusCode >= 301 && statusCode <= 308 && statusCode !== 304) {
          response.resume();
          const location = headers.location;
          if (!location) return reject(new Error("Redirect missing Location"));
          try { return follow(new URL(location, currentUrl).toString(), redirectCount + 1); }
          catch { return reject(new Error(`Invalid redirect URL: ${location}`)); }
        }
        if (statusCode !== 200) {
          response.resume();
          return reject(new Error(`HTTP ${statusCode}`));
        }
        const MAX_CHECKSUM_SIZE = 1024;
        let data = "";
        response.on("data", (chunk) => {
          data += chunk;
          if (!settled && data.length > MAX_CHECKSUM_SIZE) {
            settled = true;
            response.destroy();
            reject(new Error("Checksum file too large"));
          }
        });
        response.on("end", () => { if (!settled) resolve(data); });
      }).on("error", (err) => { if (!settled) reject(err); });
    }
    follow(url, 0);
  });
}

export async function verifyChecksum(filePath, checksumUrl, downloadFn = downloadText) {
  let checksumText;
  try {
    checksumText = await downloadFn(checksumUrl);
  } catch (err) {
    if (err.message === "HTTP 404") {
      console.warn("⚠️  No checksum file available — skipping verification");
      return;
    }
    throw new Error(`Failed to fetch checksum: ${err.message}`);
  }

  // Checksum file format: "<hash>  <filename>" or just "<hash>"
  const expectedHash = checksumText.trim().split(/\s+/)[0].toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expectedHash)) {
    throw new Error(`Invalid checksum format: ${expectedHash}`);
  }
  const actualHash = await computeFileHash(filePath);

  if (actualHash !== expectedHash) {
    try { if (existsSync(filePath)) unlinkSync(filePath); } catch {}
    throw new Error(
      `Checksum mismatch!\n   Expected: ${expectedHash}\n   Actual:   ${actualHash}`
    );
  }

  console.log("✅ Checksum verified");
}
