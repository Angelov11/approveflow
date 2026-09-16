import { randomUUID } from "node:crypto";

/**
 * M8.1: minimal structured latency instrumentation — one shared utility used
 * by every Slack-facing route instead of ad-hoc console.error strings (which
 * is all that existed before this milestone; see the M8.1 audit). Deliberately
 * small: no telemetry vendor, no new dependency, no queue — just structured
 * JSON lines on stdout, which Vercel already captures as logs.
 *
 * Pure and injectable (`now`/`log`/`requestId` overrides), matching this
 * project's established pattern for testable primitives (see
 * verify-request.ts's injectable `nowSeconds`) — no server-only dependency,
 * so it's directly unit testable without mocking the global clock/console.
 *
 * NEVER pass into `time()`/log lines: Slack bot tokens, the signing secret,
 * OAuth codes, raw Authorization/signature headers, decision comments,
 * rejection reasons, request Details/resource text, or any other request
 * content. Only IDs, bucket/label names, durations, and outcome strings.
 */

export type TimingBucket = "db" | "slack_api";

const ACK_WARN_MS = 1000;
const ACK_CRITICAL_MS = 2500;
const SLOW_THRESHOLD_MS: Record<TimingBucket, number> = { db: 400, slack_api: 900 };

export interface RequestTimer {
  readonly requestId: string;
  /** Record the cost of a synchronous stage (signature verification) in milliseconds. */
  markVerify(ms: number): void;
  /** Record the cost of a synchronous stage (payload parsing) in milliseconds. */
  markParse(ms: number): void;
  /**
   * Wrap a single DB call or Slack Web API call. Accumulates that bucket's
   * running total for the final ack() summary line, and — independently —
   * logs its own line immediately if this one call is individually slow
   * (>= the bucket's threshold), so a single slow call is identifiable even
   * within a fast-overall request.
   */
  time<T>(bucket: TimingBucket, label: string, fn: () => Promise<T>): Promise<T>;
  /**
   * Call exactly once, immediately before the HTTP response is constructed.
   * Logs the one structured summary line for this request/flow, with a
   * warn/critical level once ackMs crosses the documented thresholds.
   */
  ack(outcome: string): void;
  /**
   * Wrap work scheduled via next/server's `after()`. Logs its own
   * duration/outcome once the callback settles — this happens strictly
   * after the response was already sent, so it can never affect ackMs.
   */
  afterTask<T>(label: string, fn: () => Promise<T>): Promise<T>;
}

export interface CreateRequestTimerOptions {
  /** Injectable monotonic clock, in milliseconds. Defaults to `performance.now()`. */
  now?: () => number;
  /** Injectable log sink. Defaults to `console.log(JSON.stringify(line))`. */
  log?: (line: Record<string, unknown>) => void;
  /** Injectable correlation id. Defaults to a fresh `randomUUID()`. */
  requestId?: string;
}

function levelFor(ms: number, warnAt: number, criticalAt: number): "info" | "warn" | "error" {
  if (ms >= criticalAt) return "error";
  if (ms >= warnAt) return "warn";
  return "info";
}

export function createRequestTimer(route: string, flow: string, options: CreateRequestTimerOptions = {}): RequestTimer {
  const now = options.now ?? (() => performance.now());
  const log = options.log ?? ((line: Record<string, unknown>) => console.log(JSON.stringify(line)));
  const requestId = options.requestId ?? randomUUID();

  const start = now();
  let verifyMs = 0;
  let parseMs = 0;
  let dbTotalMs = 0;
  let slackApiTotalMs = 0;

  function emit(extra: Record<string, unknown>) {
    log({ event: "timing", requestId, route, flow, ...extra });
  }

  return {
    requestId,
    markVerify(ms: number) {
      verifyMs += ms;
    },
    markParse(ms: number) {
      parseMs += ms;
    },
    async time<T>(bucket: TimingBucket, label: string, fn: () => Promise<T>): Promise<T> {
      const t0 = now();
      try {
        return await fn();
      } finally {
        const ms = Math.round(now() - t0);
        if (bucket === "db") {
          dbTotalMs += ms;
        } else {
          slackApiTotalMs += ms;
        }
        if (ms >= SLOW_THRESHOLD_MS[bucket]) {
          emit({ level: "warn", stage: "call", bucket, label, ms, slow: true });
        }
      }
    },
    ack(outcome: string) {
      const ackMs = Math.round(now() - start);
      emit({
        level: levelFor(ackMs, ACK_WARN_MS, ACK_CRITICAL_MS),
        stage: "ack",
        outcome,
        ackMs,
        verifyMs: Math.round(verifyMs),
        parseMs: Math.round(parseMs),
        dbTotalMs: Math.round(dbTotalMs),
        slackApiTotalMs: Math.round(slackApiTotalMs),
      });
    },
    async afterTask<T>(label: string, fn: () => Promise<T>): Promise<T> {
      const t0 = now();
      try {
        const result = await fn();
        emit({ level: "info", stage: "after", label, afterMs: Math.round(now() - t0), afterOutcome: "ok" });
        return result;
      } catch (error) {
        emit({
          level: "error",
          stage: "after",
          label,
          afterMs: Math.round(now() - t0),
          afterOutcome: "error",
          afterError: error instanceof Error ? error.message : "unknown error",
        });
        throw error;
      }
    },
  };
}
