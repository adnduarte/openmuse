import { WorkerError } from "./errors.ts";

/**
 * Ref resolution for the agent computer snapshot contract.
 *
 * The browser worker is the owner of the snapshot: the caller only receives an
 * opaque `ref` and the `snapshotId` that produced it. This module is the
 * fail-closed bridge between that wire contract and the DOM attribute the
 * worker uses internally (`data-juxa-ref`), matching the contract implemented
 * by `juxa-harness` W1 (`src/core/agent-computer/snapshot-dom.ts`).
 *
 * Rules:
 *   - `ref` and `snapshotId` travel together or not at all;
 *   - a ref only resolves against the snapshot that produced it (stale id →
 *     `SNAPSHOT_STALE`, unknown ref → `REF_NOT_FOUND`);
 *   - the ref is an opaque `e` + 16 lowercase hex characters, never a CSS
 *     selector, script or path from the caller.
 */

/** DOM attribute that links an element with its opaque ref. */
export const ATRIBUTO_REF_DOM = "data-juxa-ref";

/** Opaque ref shape produced by the snapshot builder. */
export const PATRON_REF_SNAPSHOT = /^e[0-9a-f]{16}$/;

/** State kept per browser session after a snapshot. */
export interface SnapshotRefState {
  snapshotId: number;
  refs: ReadonlySet<string>;
}

/** Target parsed from an input body, or `null` when the body has no ref. */
export interface RefSnapshotInput {
  ref: string;
  snapshotId: number;
}

function errorEntrada(message: string): WorkerError {
  return new WorkerError("INVALID_INPUT", message);
}

/**
 * Parses `ref`/`snapshotId` from an input body without trusting either field.
 * Returns `null` only when BOTH are absent (legacy coordinate/text inputs).
 */
export function validarEntradaRef(input: Record<string, unknown>): RefSnapshotInput | null {
  const hasRef = input.ref !== undefined;
  const hasSnapshotId = input.snapshotId !== undefined;
  if (!hasRef && !hasSnapshotId) return null;
  if (!hasRef || !hasSnapshotId)
    throw errorEntrada("ref and snapshotId must be provided together.");
  if (typeof input.ref !== "string" || !PATRON_REF_SNAPSHOT.test(input.ref))
    throw errorEntrada("A snapshot ref must match ^e[0-9a-f]{16}$.");
  const snapshotId = input.snapshotId;
  if (
    typeof snapshotId !== "number" ||
    !Number.isInteger(snapshotId) ||
    snapshotId < 0
  )
    throw errorEntrada("snapshotId must be a non-negative integer.");
  return { ref: input.ref, snapshotId };
}

/** Playwright selector for a ref that already passed validation. */
export function selectorRefDom(ref: string): string {
  if (!PATRON_REF_SNAPSHOT.test(ref))
    throw errorEntrada("A snapshot ref must match ^e[0-9a-f]{16}$.");
  return `[${ATRIBUTO_REF_DOM}="${ref}"]`;
}

/**
 * Resolves `ref` + `snapshotId` to a Playwright selector.
 *
 * Returns `null` when the input does not carry a ref. Any inconsistency throws
 * a `WorkerError`; the caller must not act on the page in that case.
 */
export function resolverSelectorRef(
  input: Record<string, unknown>,
  state: SnapshotRefState | undefined,
): string | null {
  const target = validarEntradaRef(input);
  if (!target) return null;
  if (!state || state.snapshotId !== target.snapshotId)
    throw new WorkerError(
      "SNAPSHOT_STALE",
      "The snapshot is stale; request a new snapshot before using this ref.",
      409,
    );
  if (!state.refs.has(target.ref))
    throw new WorkerError(
      "REF_NOT_FOUND",
      "The ref does not belong to the current snapshot.",
      409,
    );
  return selectorRefDom(target.ref);
}
