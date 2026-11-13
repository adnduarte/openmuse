import assert from "node:assert/strict";
import test from "node:test";

import { WorkerError } from "../src/errors.ts";
import {
  ATRIBUTO_REF_DOM,
  PATRON_REF_SNAPSHOT,
  resolverSelectorRef,
  selectorRefDom,
  validarEntradaRef,
  type SnapshotRefState,
} from "../src/snapshot-refs.ts";

const REF = "e0123456789abcdef";
const state: SnapshotRefState = { snapshotId: 4, refs: new Set([REF]) };

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    assert(error instanceof WorkerError, "expected a WorkerError");
    return error.code;
  }
  assert.fail("expected the call to throw");
}

test("sin ref ni snapshotId no hay resolución (entradas legacy intactas)", () => {
  assert.equal(validarEntradaRef({ type: "scroll", deltaY: 100 }), null);
  assert.equal(resolverSelectorRef({ type: "scroll", deltaY: 100 }, state), null);
});

test("ref→selector usa exactamente data-juxa-ref y el contrato de W1", () => {
  assert.equal(ATRIBUTO_REF_DOM, "data-juxa-ref");
  assert.equal(PATRON_REF_SNAPSHOT.test(REF), true);
  assert.equal(selectorRefDom(REF), `[data-juxa-ref="${REF}"]`);
  assert.equal(
    resolverSelectorRef({ ref: REF, snapshotId: 4 }, state),
    `[data-juxa-ref="${REF}"]`,
  );
});

test("ref y snapshotId deben viajar juntos", () => {
  assert.equal(codeOf(() => resolverSelectorRef({ ref: REF }, state)), "INVALID_INPUT");
  assert.equal(
    codeOf(() => resolverSelectorRef({ snapshotId: 4 }, state)),
    "INVALID_INPUT",
  );
});

test("rechaza refs que no son opacos e+16 hex (sin selectores ni rutas)", () => {
  const invalidos: unknown[] = [
    "",
    "e0123456789abcde",
    "e0123456789abcdef0",
    "E0123456789ABCDEF",
    "e0123456789abcdeg",
    "../etc/passwd",
    `e0123456789abcde"`,
    "e0123456789abcdef]",
    "button",
    123,
    null,
  ];
  for (const ref of invalidos) {
    assert.equal(
      codeOf(() => resolverSelectorRef({ ref, snapshotId: 4 }, state)),
      "INVALID_INPUT",
      `ref should be rejected: ${String(ref)}`,
    );
  }
});

test("rechaza snapshotId no entero o negativo", () => {
  for (const snapshotId of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "4", null]) {
    assert.equal(
      codeOf(() => resolverSelectorRef({ ref: REF, snapshotId }, state)),
      "INVALID_INPUT",
      `snapshotId should be rejected: ${String(snapshotId)}`,
    );
  }
});

test("snapshot vencido o ausente → SNAPSHOT_STALE (fail-closed)", () => {
  assert.equal(
    codeOf(() => resolverSelectorRef({ ref: REF, snapshotId: 3 }, state)),
    "SNAPSHOT_STALE",
  );
  assert.equal(
    codeOf(() => resolverSelectorRef({ ref: REF, snapshotId: 5 }, state)),
    "SNAPSHOT_STALE",
  );
  assert.equal(
    codeOf(() => resolverSelectorRef({ ref: REF, snapshotId: 4 }, undefined)),
    "SNAPSHOT_STALE",
  );
});

test("ref ajeno al snapshot vigente → REF_NOT_FOUND", () => {
  assert.equal(
    codeOf(() =>
      resolverSelectorRef({ ref: "e0000000000000000", snapshotId: 4 }, state),
    ),
    "REF_NOT_FOUND",
  );
});

test("un snapshot nuevo reemplaza los refs anteriores", () => {
  const nuevo: SnapshotRefState = {
    snapshotId: 5,
    refs: new Set(["e0000000000000001"]),
  };
  assert.equal(
    codeOf(() => resolverSelectorRef({ ref: REF, snapshotId: 4 }, nuevo)),
    "SNAPSHOT_STALE",
  );
  assert.equal(
    resolverSelectorRef({ ref: "e0000000000000001", snapshotId: 5 }, nuevo),
    `[data-juxa-ref="e0000000000000001"]`,
  );
});
