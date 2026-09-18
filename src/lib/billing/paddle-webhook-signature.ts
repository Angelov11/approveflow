import { NodeRuntime, Webhooks, type EventEntity } from "@paddle/paddle-node-sdk";

/**
 * Thin wrapper around the official SDK's webhook verifier — Webhooks
 * needs no API key/config (signature verification is pure local HMAC, no
 * Paddle API call), so this has no env dependency and is directly unit
 * testable with a synthetic signature. Throws on any failure (bad
 * signature, stale timestamp — the SDK's own tolerance is 5 seconds,
 * measured from the signature's own `ts`, not from when we received the
 * request — or malformed body); the caller (POST /api/paddle/webhooks)
 * catches this in one place and returns a single non-2xx, since the SDK
 * doesn't distinguish which of those three actually happened.
 *
 * NodeRuntime.initialize() is NOT a no-op to skip: the SDK only wires up
 * its HMAC implementation as a side effect of constructing a `Paddle`
 * instance (see node_modules/@paddle/paddle-node-sdk's index.cjs.node.js)
 * — a bare `new Webhooks()` without ever having constructed one silently
 * treats every signature as invalid (logging "Unknown runtime"), rather
 * than throwing loudly. Calling it here keeps signature verification
 * fully independent of getPaddleClient()/PADDLE_API_KEY — this route has
 * no reason to depend on Paddle API credentials it never actually calls.
 * Idempotent and cheap; called unconditionally rather than cached, since
 * that's strictly safer across however a serverless runtime reuses (or
 * doesn't reuse) module scope between invocations.
 */
export async function verifyAndParsePaddleWebhook(rawBody: string, secret: string, signatureHeader: string): Promise<EventEntity> {
  NodeRuntime.initialize();
  return new Webhooks().unmarshal(rawBody, secret, signatureHeader);
}
