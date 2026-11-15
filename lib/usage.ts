/**
 * Token usage and cost tracking for the evaluation scripts (scripts/run-scenarios.ts).
 * Every model call reports its usage here; an optional budget stops a run once spending crosses it.
 * Prices are per million tokens (Anthropic first-party API, as of 2026-11).
 */

type Price = { input: number; output: number; cacheWrite: number; cacheRead: number };

const PRICES: Record<string, Price> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
  // Models the server-side fallback can route to.
  "claude-opus-5": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheWrite: 6.25, cacheRead: 0.5 },
  "claude-sonnet-5": { input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.2 },
};

export type Usage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

export type Tally = { calls: number; input: number; output: number; cacheWrite: number; cacheRead: number; usd: number };

const emptyTally = (): Tally => ({ calls: 0, input: 0, output: 0, cacheWrite: 0, cacheRead: 0, usd: 0 });

let total = emptyTally();
let budgetUsd: number | null = null;
let spentBefore = 0; // spending from earlier runs (read from the ledger by the script)

export class BudgetExceededError extends Error {}

export function costOf(model: string, u: Usage): number {
  // Unknown model ids are priced at the most expensive known rate, so the budget errs on the safe side.
  const p = PRICES[model] ?? PRICES["claude-opus-5"];
  return (
    ((u.input_tokens ?? 0) * p.input +
      (u.output_tokens ?? 0) * p.output +
      (u.cache_creation_input_tokens ?? 0) * p.cacheWrite +
      (u.cache_read_input_tokens ?? 0) * p.cacheRead) /
    1_000_000
  );
}

export function recordUsage(model: string, u: Usage | null | undefined) {
  if (!u) return;
  total.calls += 1;
  total.input += u.input_tokens ?? 0;
  total.output += u.output_tokens ?? 0;
  total.cacheWrite += u.cache_creation_input_tokens ?? 0;
  total.cacheRead += u.cache_read_input_tokens ?? 0;
  total.usd += costOf(model, u);
}

/** Throws before a call when the budget is already spent. */
export function checkBudget() {
  if (budgetUsd != null && spentBefore + total.usd >= budgetUsd) {
    throw new BudgetExceededError(`Budget of $${budgetUsd} reached ($${(spentBefore + total.usd).toFixed(2)} spent).`);
  }
}

export function setBudget(usd: number | null, alreadySpent = 0) {
  budgetUsd = usd;
  spentBefore = alreadySpent;
}

export function snapshot(): Tally {
  return { ...total };
}

export function diff(a: Tally, b: Tally): Tally {
  return {
    calls: b.calls - a.calls,
    input: b.input - a.input,
    output: b.output - a.output,
    cacheWrite: b.cacheWrite - a.cacheWrite,
    cacheRead: b.cacheRead - a.cacheRead,
    usd: b.usd - a.usd,
  };
}
