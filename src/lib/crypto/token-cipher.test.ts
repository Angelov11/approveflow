import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { decodeEncryptionKey, decryptSecret, encryptSecret } from "./token-cipher.ts";

const key = randomBytes(32);

test("encrypt then decrypt returns the original plaintext", () => {
  const encrypted = encryptSecret("x", key);
  assert.equal(decryptSecret(encrypted, key), "x");
});

test("encrypting the same value twice produces different ciphertext and IV", () => {
  const first = encryptSecret("xoxb-same-token", key);
  const second = encryptSecret("xoxb-same-token", key);
  assert.notEqual(first.iv, second.iv);
  assert.notEqual(first.ciphertext, second.ciphertext);
});

test("decodeEncryptionKey rejects a key of the wrong length", () => {
  assert.throws(() => decodeEncryptionKey(Buffer.from("too-short").toString("base64")));
  assert.throws(() => decodeEncryptionKey(randomBytes(16).toString("base64")));
  assert.doesNotThrow(() => decodeEncryptionKey(randomBytes(32).toString("base64")));
});

test("tampered ciphertext fails decryption", () => {
  const encrypted = encryptSecret("xoxb-secret", key);
  const tamperedBytes = Buffer.from(encrypted.ciphertext, "base64");
  tamperedBytes[0] ^= 0xff;
  const tampered = { ...encrypted, ciphertext: tamperedBytes.toString("base64") };
  assert.throws(() => decryptSecret(tampered, key));
});

test("tampered auth tag fails decryption", () => {
  const encrypted = encryptSecret("xoxb-secret", key);
  const tamperedBytes = Buffer.from(encrypted.authTag, "base64");
  tamperedBytes[0] ^= 0xff;
  const tampered = { ...encrypted, authTag: tamperedBytes.toString("base64") };
  assert.throws(() => decryptSecret(tampered, key));
});

test("decrypting with the wrong key fails", () => {
  const encrypted = encryptSecret("xoxb-secret", key);
  assert.throws(() => decryptSecret(encrypted, randomBytes(32)));
});
