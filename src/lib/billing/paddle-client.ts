import "server-only";

import { Environment, Paddle } from "@paddle/paddle-node-sdk";

import { serverEnv } from "../env.server.ts";
import { validatePaddleEnvironmentConfig } from "./paddle-environment-guard.ts";

/**
 * Server-side Paddle client. Uses the official Node SDK (@paddle/paddle-node-sdk)
 * rather than a hand-rolled fetch wrapper: it already handles auth headers,
 * the sandbox-vs-production API base URL, and typed request/response
 * shapes for the transaction/subscription/customer-portal operations this
 * app needs — reimplementing that correctly (and staying correct as
 * Paddle's API evolves) is a worse security/maintenance trade than a
 * dependency maintained by Paddle itself. No custom payment abstraction
 * layer on top of it: callers use this client directly.
 *
 * Fails loudly (throws) rather than silently defaulting if
 * PADDLE_ENVIRONMENT/PADDLE_API_KEY/NEXT_PUBLIC_PADDLE_CLIENT_TOKEN are
 * missing or mismatched — see paddle-environment-guard.ts. Never
 * initialized at module load time for routes that don't need it; callers
 * call getPaddleClient() lazily.
 */
let client: Paddle | undefined;

export function getPaddleClient(): Paddle {
  if (client) {
    return client;
  }

  const guard = validatePaddleEnvironmentConfig({
    environment: serverEnv.PADDLE_ENVIRONMENT,
    apiKey: serverEnv.PADDLE_API_KEY,
    clientToken: serverEnv.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN,
  });
  if (!guard.valid) {
    throw new Error(`Paddle environment misconfigured: ${guard.reason}`);
  }

  client = new Paddle(serverEnv.PADDLE_API_KEY as string, {
    environment: serverEnv.PADDLE_ENVIRONMENT === "live" ? Environment.production : Environment.sandbox,
  });
  return client;
}
