import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const OPTIONS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const derive = (password: string, salt: string) => new Promise<Buffer>((resolve, reject) => {
  scrypt(password, salt, 64, OPTIONS, (error, key) => error ? reject(error) : resolve(key));
});

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  return `scrypt-v1$${salt}$${(await derive(password, salt)).toString("hex")}`;
}

/** Missing accounts still perform the same expensive derivation as a wrong password. */
export async function verifyPassword(password: string, encoded: string | null): Promise<boolean> {
  const match = /^scrypt-v1\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(encoded ?? "");
  const actual = await derive(password, match?.[1] ?? "00000000000000000000000000000000");
  const expected = match ? Buffer.from(match[2]!, "hex") : Buffer.alloc(64);
  return timingSafeEqual(actual, expected) && match !== null;
}
