/**
 * Amount/currency for Expense / Purchase requests. No FX conversion, no
 * currency API, no localization engine — a fixed, small, MVP-practical
 * currency list and a plain decimal amount are all this needs.
 */
export const SUPPORTED_CURRENCIES = ["USD", "EUR", "GBP", "MKD", "CAD", "AUD"] as const;
export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];

export interface RequestExpense {
  /** Parsed amount, already validated (> 0, at most 2 decimal places) — see validateExpense. */
  amount: number | null;
  currency: string | null;
}

export type ExpenseValidationResult =
  | { ok: true; data: RequestExpense }
  | { ok: false; errors: Record<string, string> };

export const EXPENSE_AMOUNT_BLOCK_ID = "expense_amount_block";
export const EXPENSE_AMOUNT_ACTION_ID = "expense_amount_input";
export const EXPENSE_CURRENCY_BLOCK_ID = "expense_currency_block";
export const EXPENSE_CURRENCY_ACTION_ID = "expense_currency_select";

// Ordinary workplace purchases — generous enough not to be annoying, low
// enough to catch an obvious fat-fingered extra digit. Not a policy limit.
const MAX_AMOUNT = 1_000_000;
// Up to 7 digits before the decimal point (matching MAX_AMOUNT) and exactly
// 0-2 after — rejects a 3rd decimal place outright rather than rounding it
// away, since the database's own numeric(10,2) column would silently round
// instead of erroring.
const AMOUNT_PATTERN = /^\d{1,9}(\.\d{1,2})?$/;

/**
 * Both fields are required together for an expense-mode request — see
 * request-type-config.ts for which request types actually reach this path.
 * A crafted/malformed value is rejected outright, never coerced or rounded.
 */
export function validateExpense(input: { amount: string | null; currency: string | null }): ExpenseValidationResult {
  const errors: Record<string, string> = {};
  const rawAmount = input.amount?.trim() ?? "";
  const rawCurrency = input.currency?.trim().toUpperCase() ?? "";

  let amount: number | null = null;
  if (rawAmount.length === 0) {
    errors[EXPENSE_AMOUNT_BLOCK_ID] = "Please enter an amount.";
  } else if (!AMOUNT_PATTERN.test(rawAmount)) {
    errors[EXPENSE_AMOUNT_BLOCK_ID] = "Please enter a positive amount with at most 2 decimal places (e.g. 499.99).";
  } else {
    const parsed = Number(rawAmount);
    if (parsed <= 0) {
      errors[EXPENSE_AMOUNT_BLOCK_ID] = "Amount must be greater than zero.";
    } else if (parsed > MAX_AMOUNT) {
      errors[EXPENSE_AMOUNT_BLOCK_ID] = `Amount must be ${MAX_AMOUNT.toLocaleString("en-US")} or less.`;
    } else {
      amount = parsed;
    }
  }

  if (rawCurrency.length === 0) {
    errors[EXPENSE_CURRENCY_BLOCK_ID] = "Please select a currency.";
  } else if (!SUPPORTED_CURRENCIES.includes(rawCurrency as CurrencyCode)) {
    errors[EXPENSE_CURRENCY_BLOCK_ID] = "Please select a supported currency.";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, data: { amount, currency: rawCurrency } };
}

/** `null` when either half is missing — callers omit the field entirely rather than rendering a partial "EUR" or a bare number. */
export function formatAmountLabel(amount: number | null, currency: string | null): string | null {
  if (amount === null || !currency) {
    return null;
  }
  return `${currency} ${amount.toFixed(2)}`;
}
