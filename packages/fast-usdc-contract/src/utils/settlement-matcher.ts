/**
 * @file Settlement-matching utilities for USDC transactions.
 *
 * This module maintains a `MapStore<NobleAddress, PendingTx[]>` where pending transactions
 * for each Noble address are kept in **descending order** by `tx.amount`. This sorting
 * invariant enables efficient resolution of new mints through two approaches:
 *   1. Exact-amount direct lookup (O(n) time complexity)
 *   2. Greedy combination algorithm that processes transactions from largest to smallest
 *
 * The greedy strategy is deterministic and auditable: it always selects the largest
 * transaction that doesn't exceed the remaining target until the full amount is matched.
 * If no valid combination exists, an empty array is returned.
 *
 * Implementation includes memoization and depth-limiting to ensure performance even with
 * larger transaction sets, though typical match depth is 2-3 transactions.
 */

import type { MapStore } from '@agoric/swingset-liveslots';
import type { NobleAddress, PendingTx } from '@agoric/fast-usdc/src/types.ts';
import { appendToSortedStoredArray } from './store.ts';

/**
 * Max number of txs to settle against a single mint.
 * Much higher than observed value of 2-3.
 */
const MAX_MATCH_DEPTH = 25;

/** bigint‑safe descending comparator (largest first) */
const comparePendingTxDesc = (a: PendingTx, b: PendingTx): number =>
  Number(b.tx.amount - a.tx.amount);

harden(comparePendingTxDesc);

/**
 * Depth‑first, memoised, largest‑first chooser.
 * Returns the *first* exact combination or [] if none.
 */
const greedyMatch = (
  pending: readonly PendingTx[],
  target: bigint,
): PendingTx[] => {
  if (target === 0n) return [];
  if (pending.length === 0) return [];

  const memo = new Map<string, boolean>();
  const path: PendingTx[] = [];

  const dfs = (index: number, sum: bigint): boolean => {
    if (sum === target) return true;
    if (sum > target) return false; // unreachable with current continue‑on‑overshoot logic
    if (path.length >= MAX_MATCH_DEPTH)
      throw new Error(
        `MAX_MATCH_DEPTH: ${MAX_MATCH_DEPTH} exceeded for ${pending[0].tx.forwardingAddress}`,
      );

    if (index >= pending.length) return false;

    const key = `${index}:${sum}`;
    if (memo.get(key) === false) return false; // skip known dead end

    for (let i = index; i < pending.length; i += 1) {
      const tx = pending[i];
      const nextSum = sum + tx.tx.amount;
      if (nextSum > target) continue; // overshoot, skip

      path.push(tx);
      if (dfs(i + 1, nextSum)) return true;
      path.pop();
    }

    memo.set(key, false);
    return false;
  };

  return dfs(0, 0n) ? harden([...path]) : [];
};

harden(greedyMatch);

export const makeSettlementMatcher = (
  pendingSettleTxs: MapStore<NobleAddress, PendingTx[]>,
) => {
  /** add to per‑address queue, preserving descending sort */
  const addPendingSettleTx = (pending: PendingTx): void => {
    appendToSortedStoredArray(
      pendingSettleTxs,
      pending.tx.forwardingAddress,
      pending,
      comparePendingTxDesc,
    );
  };

  /**
   * Attempt to satisfy `amount` for `nfa`.  Returns the matched txs (possibly
   * empty).  Updates the MapStore so those txs are no longer pending.
   */
  const matchAndDequeueSettlement = (
    nfa: NobleAddress,
    amount: bigint,
  ): PendingTx[] => {
    if (!pendingSettleTxs.has(nfa)) return [];
    const list = pendingSettleTxs.get(nfa);

    // 1. exact
    const ix = list.findIndex(tx => tx.tx.amount === amount);
    if (ix >= 0) {
      const match = list[ix];
      if (list.length > 1) {
        const remaining = [...list.slice(0, ix), ...list.slice(ix + 1)];
        pendingSettleTxs.set(nfa, harden(remaining));
      } else {
        pendingSettleTxs.delete(nfa);
      }
      return [match];
    }

    // 2. greedy combination
    const combo = greedyMatch(list, amount);
    if (combo.length) {
      if (list.length - combo.length > 1) {
        const matchedSet = new Set(combo); // identity compare is safe here
        const remaining = list.filter(tx => !matchedSet.has(tx));
        pendingSettleTxs.set(nfa, harden(remaining));
      } else {
        pendingSettleTxs.delete(nfa);
      }
    }
    return combo;
  };

  return harden({ addPendingSettleTx, matchAndDequeueSettlement });
};

export type SettlementMatcher = ReturnType<typeof makeSettlementMatcher>;
