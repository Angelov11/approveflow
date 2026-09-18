/**
 * Fails loudly on the obvious Paddle sandbox/live misconfiguration: an
 * PADDLE_ENVIRONMENT that doesn't match the credential prefixes Paddle
 * itself uses to mark which environment a key/token belongs to. Pure —
 * no env access, no server-only dependency — so it's directly unit
 * testable; callers pass in the three raw values from env.server.ts.
 *
 * Prefixes confirmed against official Paddle documentation
 * (developer.paddle.com/api-reference/about/authentication and
 * developer.paddle.com/paddle-js/about/client-side-tokens): server-side
 * API keys are `pdl_sdbx_apikey_...` (sandbox) / `pdl_live_apikey_...`
 * (live); Paddle.js client-side tokens are `test_...` (sandbox) /
 * `live_...` (live).
 */

const SANDBOX_API_KEY_PREFIX = "pdl_sdbx_apikey_";
const LIVE_API_KEY_PREFIX = "pdl_live_apikey_";
const SANDBOX_CLIENT_TOKEN_PREFIX = "test_";
const LIVE_CLIENT_TOKEN_PREFIX = "live_";

export interface ValidatePaddleEnvironmentConfigParams {
  environment: string | undefined;
  apiKey: string | undefined;
  clientToken: string | undefined;
}

export type PaddleEnvironmentGuardResult = { valid: true } | { valid: false; reason: string };

export function validatePaddleEnvironmentConfig({
  environment,
  apiKey,
  clientToken,
}: ValidatePaddleEnvironmentConfigParams): PaddleEnvironmentGuardResult {
  if (environment !== "sandbox" && environment !== "live") {
    return { valid: false, reason: `PADDLE_ENVIRONMENT must be "sandbox" or "live", got: ${String(environment)}` };
  }
  if (!apiKey) {
    return { valid: false, reason: "PADDLE_API_KEY is not set" };
  }
  if (!clientToken) {
    return { valid: false, reason: "NEXT_PUBLIC_PADDLE_CLIENT_TOKEN is not set" };
  }

  const isSandbox = environment === "sandbox";
  const expectedApiKeyPrefix = isSandbox ? SANDBOX_API_KEY_PREFIX : LIVE_API_KEY_PREFIX;
  const oppositeApiKeyPrefix = isSandbox ? LIVE_API_KEY_PREFIX : SANDBOX_API_KEY_PREFIX;
  if (apiKey.startsWith(oppositeApiKeyPrefix)) {
    return { valid: false, reason: `PADDLE_API_KEY looks like a ${isSandbox ? "live" : "sandbox"} key but PADDLE_ENVIRONMENT=${environment}` };
  }
  if (!apiKey.startsWith(expectedApiKeyPrefix)) {
    return { valid: false, reason: `PADDLE_API_KEY does not look like a valid Paddle ${environment} API key (expected ${expectedApiKeyPrefix}...)` };
  }

  const expectedClientTokenPrefix = isSandbox ? SANDBOX_CLIENT_TOKEN_PREFIX : LIVE_CLIENT_TOKEN_PREFIX;
  const oppositeClientTokenPrefix = isSandbox ? LIVE_CLIENT_TOKEN_PREFIX : SANDBOX_CLIENT_TOKEN_PREFIX;
  if (clientToken.startsWith(oppositeClientTokenPrefix)) {
    return {
      valid: false,
      reason: `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN looks like a ${isSandbox ? "live" : "sandbox"} token but PADDLE_ENVIRONMENT=${environment}`,
    };
  }
  if (!clientToken.startsWith(expectedClientTokenPrefix)) {
    return {
      valid: false,
      reason: `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN does not look like a valid Paddle ${environment} client token (expected ${expectedClientTokenPrefix}...)`,
    };
  }

  return { valid: true };
}
