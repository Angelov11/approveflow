/**
 * Minimal shape of the Slack Events API outer envelope needed by this app —
 * either the one-time `url_verification` handshake, or an `event_callback`
 * wrapping an inner event. Both share the same request signature scheme as
 * every other Slack surface (see verify-request.ts), verified upstream of
 * this parser — this file only classifies an already-authenticated payload.
 */
export interface SlackEventEnvelope {
  type?: string;
  challenge?: string;
  team_id?: string;
  event?: {
    type?: string;
    user?: string;
    /** Distinguishes the Home tab from the Messages tab — a `messages` open must never republish Home. */
    tab?: string;
  };
}

export type ParsedSlackEvent =
  | { kind: "url_verification"; challenge: string }
  | { kind: "app_home_opened"; slackTeamId: string; slackUserId: string }
  | { kind: "ignored" };

/** Never throws — any shape that doesn't match a known, well-formed case is safely classified as "ignored". */
export function parseSlackEvent(envelope: SlackEventEnvelope): ParsedSlackEvent {
  if (envelope.type === "url_verification") {
    return typeof envelope.challenge === "string" && envelope.challenge.length > 0
      ? { kind: "url_verification", challenge: envelope.challenge }
      : { kind: "ignored" };
  }

  if (envelope.type === "event_callback" && envelope.event?.type === "app_home_opened" && envelope.event.tab === "home") {
    const slackTeamId = envelope.team_id;
    const slackUserId = envelope.event.user;
    if (slackTeamId && slackUserId) {
      return { kind: "app_home_opened", slackTeamId, slackUserId };
    }
  }

  return { kind: "ignored" };
}
