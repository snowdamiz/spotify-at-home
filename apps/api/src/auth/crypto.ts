import { createHash, randomBytes } from "node:crypto";

export function randomToken(byteLength = 32) {
  return randomBytes(byteLength).toString("base64url");
}

export function sha256Base64Url(value: string) {
  return createHash("sha256").update(value).digest("base64url");
}

export function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
