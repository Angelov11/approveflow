import assert from "node:assert/strict";
import test from "node:test";
import { formatAmountLabel, SUPPORTED_CURRENCIES, validateExpense } from "./expense.ts";

test("a valid amount and currency is accepted, trimmed, and parsed to a number", () => {
  const result = validateExpense({ amount: " 499.99 ", currency: " eur " });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.amount, 499.99);
    assert.equal(result.data.currency, "EUR");
  }
});

test("an integer amount (no decimals) is accepted", () => {
  const result = validateExpense({ amount: "500", currency: "USD" });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.data.amount, 500);
  }
});

test("a missing amount is rejected", () => {
  const result = validateExpense({ amount: null, currency: "USD" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.expense_amount_block);
});

test("a missing currency is rejected", () => {
  const result = validateExpense({ amount: "10", currency: null });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.expense_currency_block);
});

test("zero is rejected", () => {
  const result = validateExpense({ amount: "0", currency: "USD" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.expense_amount_block);
});

test("a negative amount is rejected", () => {
  const result = validateExpense({ amount: "-5", currency: "USD" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.expense_amount_block);
});

test("more than 2 decimal places is rejected outright, never rounded", () => {
  const result = validateExpense({ amount: "499.999", currency: "USD" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.expense_amount_block);
});

test("a non-numeric amount is rejected", () => {
  const result = validateExpense({ amount: "not-a-number", currency: "USD" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.expense_amount_block);
});

test("an amount above the sensible maximum is rejected", () => {
  const result = validateExpense({ amount: "10000000", currency: "USD" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.expense_amount_block);
});

test("an unsupported currency is rejected", () => {
  const result = validateExpense({ amount: "10", currency: "XYZ" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.ok(result.errors.expense_currency_block);
});

test("every documented MVP currency is accepted", () => {
  for (const currency of SUPPORTED_CURRENCIES) {
    const result = validateExpense({ amount: "10", currency });
    assert.equal(result.ok, true, `expected ${currency} to be accepted`);
  }
});

test("the MVP currency list is exactly USD, EUR, GBP, MKD plus a small extra set — no FX infrastructure implied", () => {
  assert.deepEqual(SUPPORTED_CURRENCIES, ["USD", "EUR", "GBP", "MKD", "CAD", "AUD"]);
});

// --- Formatting ---

test("formatAmountLabel renders 'CURRENCY amount' with exactly 2 decimal places", () => {
  assert.equal(formatAmountLabel(499.99, "EUR"), "EUR 499.99");
  assert.equal(formatAmountLabel(500, "USD"), "USD 500.00");
});

test("formatAmountLabel returns null when either half is missing — never a partial render", () => {
  assert.equal(formatAmountLabel(null, "EUR"), null);
  assert.equal(formatAmountLabel(499.99, null), null);
  assert.equal(formatAmountLabel(null, null), null);
});
