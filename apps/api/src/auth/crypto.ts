import { createHash, randomBytes, randomInt } from "node:crypto";

const entryKeyAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

export function randomToken(byteLength = 32) {
  return randomBytes(byteLength).toString("base64url");
}

export function randomEntryKey(length = 5) {
  let key = "";

  for (let i = 0; i < length; i += 1) {
    key += entryKeyAlphabet[randomInt(entryKeyAlphabet.length)];
  }

  return key;
}

export function sha256Base64Url(value: string) {
  return createHash("sha256").update(value).digest("base64url");
}

export function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
