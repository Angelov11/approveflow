import "server-only";

import { serverEnv } from "@/lib/env.server";
import { decodeEncryptionKey, decryptSecret, encryptSecret, type EncryptedSecret } from "@/lib/crypto/token-cipher";

export type { EncryptedSecret };

function loadKey(): Buffer {
  if (!serverEnv.SLACK_TOKEN_ENCRYPTION_KEY) {
    throw new Error("SLACK_TOKEN_ENCRYPTION_KEY is not set.");
  }
  return decodeEncryptionKey(serverEnv.SLACK_TOKEN_ENCRYPTION_KEY);
}

/** Encrypts a Slack bot token for storage. Never log or persist the plaintext. */
export function encryptBotToken(token: string): EncryptedSecret {
  return encryptSecret(token, loadKey());
}

export function decryptBotToken(encrypted: EncryptedSecret): string {
  return decryptSecret(encrypted, loadKey());
}
