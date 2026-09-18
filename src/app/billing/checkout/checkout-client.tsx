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

const buttonStyle = {
  marginTop: "0.5rem",
  padding: "0.6rem 1.2rem",
  borderRadius: "6px",
  background: "#4A154B",
  color: "#fff",
  border: "none",
  cursor: "pointer",
};

export interface CheckoutClientProps {
  transactionId: string;
  clientToken: string;
  environment: "sandbox" | "production";
}

/**
 * Opens Paddle Checkout for a Transaction created server-side (see
 * page.tsx) — never with client-supplied items/priceId/quantity/customData.
 * `checkout.completed` here is UX only ("we saw the browser succeed"), not
 * an entitlement source: Pro is granted later by a verified Paddle webhook
 * (M10.3), not by this event firing. workspace_subscriptions is not
 * touched from this page at all.
 */
export function CheckoutClient({ transactionId, clientToken, environment }: CheckoutClientProps) {
  const [paddle, setPaddle] = useState<Paddle | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "completed" | "error">("loading");

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

  function reopenCheckout() {
    paddle?.Checkout.open({ transactionId });
  }

  return (
    <main style={mainStyle}>
      <h1>ApproveGo Pro</h1>
      <p>$19/month per workspace</p>
      {status === "completed" ? (
        <p>Payment received. ApproveGo is confirming your subscription.</p>
      ) : status === "error" ? (
        <p>Something went wrong opening checkout. Please try again from Slack.</p>
      ) : (
        <>
          <p>Opening secure checkout…</p>
          <button type="button" onClick={reopenCheckout} disabled={!paddle} style={buttonStyle}>
            Open Checkout
          </button>
        </>
      )}
    </main>
  );
}
