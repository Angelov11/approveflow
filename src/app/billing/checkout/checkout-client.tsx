"use client";

import { initializePaddle, type Paddle } from "@paddle/paddle-js";
import { useEffect, useState } from "react";

const mainStyle = {
  display: "flex",
  flexDirection: "column" as const,
  alignItems: "center",
  justifyContent: "center",
  flex: 1,
  textAlign: "center" as const,
  padding: "2rem",
  gap: "0.75rem",
};

const linkButtonStyle = {
  padding: "0.5rem 1rem",
  borderRadius: "6px",
  background: "transparent",
  color: "#9aa0a6",
  border: "1px solid #3a3a3a",
  cursor: "pointer",
  fontSize: "0.85rem",
};

export interface CheckoutClientProps {
  transactionId: string;
  clientToken: string;
  environment: "sandbox" | "production";
}

/** How long to wait before showing a fallback link, in case the overlay genuinely failed to render (e.g. blocked by a popup blocker) without Paddle.js firing checkout.error. */
const FALLBACK_DELAY_MS = 4000;

/**
 * Opens Paddle Checkout for a Transaction created server-side (see
 * page.tsx) — never with client-supplied items/priceId/quantity/customData.
 * `checkout.completed` here is UX only ("we saw the browser succeed"), not
 * an entitlement source: Pro is granted later by a verified Paddle webhook
 * (M10.3), not by this event firing. workspace_subscriptions is not
 * touched from this page at all.
 *
 * Deliberately renders no visible "Open Checkout" button/heading while
 * loading — Paddle.Checkout.open() is called automatically the instant
 * Paddle.js initializes, so the overlay should appear directly over a
 * blank/near-empty page rather than a page that itself looks like a
 * manual step. The fallback link only appears after a delay, purely as a
 * recovery path if the overlay silently failed to render.
 */
export function CheckoutClient({ transactionId, clientToken, environment }: CheckoutClientProps) {
  const [paddle, setPaddle] = useState<Paddle | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "completed" | "error">("loading");
  const [showFallback, setShowFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;
    initializePaddle({
      token: clientToken,
      environment,
      eventCallback: (event) => {
        if (event.name === "checkout.completed") {
          setStatus("completed");
        } else if (event.name === "checkout.error") {
          setStatus("error");
        }
      },
    }).then((p) => {
      if (cancelled) {
        return;
      }
      if (!p) {
        setStatus("error");
        return;
      }
      setPaddle(p);
      setStatus("ready");
      p.Checkout.open({ transactionId });
    });
    return () => {
      cancelled = true;
    };
  }, [transactionId, clientToken, environment]);

  useEffect(() => {
    if (status !== "ready") {
      return;
    }
    const timer = setTimeout(() => setShowFallback(true), FALLBACK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [status]);

  function reopenCheckout() {
    paddle?.Checkout.open({ transactionId });
  }

  if (status === "completed") {
    return (
      <main style={mainStyle}>
        <p>Payment received. ApproveGo is confirming your subscription.</p>
      </main>
    );
  }

  if (status === "error") {
    return (
      <main style={mainStyle}>
        <p>Something went wrong opening checkout. Please try again from Slack.</p>
      </main>
    );
  }

  return (
    <main style={mainStyle}>
      {showFallback && (
        <button type="button" onClick={reopenCheckout} style={linkButtonStyle}>
          Checkout not showing? Click here
        </button>
      )}
    </main>
  );
}
