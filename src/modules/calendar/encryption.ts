import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
// AES-256-GCM from Node/OpenSSL. AAD binds ciphertext to owner, resource and use.
export function credentialCipher(keys: Record<string, string>, activeId: string) {
  const decoded = Object.fromEntries(Object.entries(keys).map(([id, value]) => { const key = Buffer.from(value, "base64"); if (!/^[A-Za-z0-9_-]{1,32}$/.test(id) || key.length !== 32 || key.toString("base64") !== value) throw new Error("Invalid Calendar encryption configuration."); return [id, key]; }));
  if (!decoded[activeId]) throw new Error("Invalid Calendar encryption configuration.");
  return {
    encrypt(value: string, context: string) { const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", decoded[activeId], iv); cipher.setAAD(Buffer.from(context)); const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]); return ["v1", activeId, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), body.toString("base64url")].join("."); },
    decrypt(value: string, context: string) { try { const [format, id, iv, tag, body, extra] = value.split("."); if (format !== "v1" || !decoded[id] || !iv || !tag || !body || extra) throw new Error(); const decipher = createDecipheriv("aes-256-gcm", decoded[id], Buffer.from(iv, "base64url")); decipher.setAAD(Buffer.from(context)); decipher.setAuthTag(Buffer.from(tag, "base64url")); return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8"); } catch { throw new Error("Calendar credentials cannot be decrypted."); } },
  };
}
