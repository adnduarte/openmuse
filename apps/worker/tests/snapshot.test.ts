import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSnapshot,
  SNAPSHOT_MAX_BYTES,
  SNAPSHOT_MAX_ELEMENTS,
  SNAPSHOT_MAX_NAME_LENGTH,
  type SnapshotAxNode,
} from "../src/snapshot.ts";

const page = { url: "https://example.test/page", title: "Fixture" };

function node(
  role: string,
  name: string,
  extra: Partial<SnapshotAxNode> = {},
): SnapshotAxNode {
  return { role: { value: role }, name: { value: name }, ...extra };
}

test("snapshot maps accessible roles/names and ignores structural nodes", () => {
  const snapshot = buildSnapshot(
    [
      node("RootWebArea", "Fixture"),
      node("generic", ""),
      node("StaticText", "Visible text"),
      {
        ...node("button", "  Save\n document  "),
        ignored: true,
      },
      node("button", "Save document"),
      node("textbox", "Email", {
        value: { value: "person@example.test" },
        properties: [{ name: "disabled", value: { value: true } }],
      }),
      node("checkbox", "Remember me", {
        properties: [{ name: "checked", value: { value: false } }],
      }),
      node("link", "Next page"),
      node("heading", "Snapshot fixture"),
    ],
    page,
  );

  assert.equal(snapshot.url, page.url);
  assert.equal(snapshot.title, page.title);
  assert.equal(snapshot.truncated, false);
  assert.deepEqual(
    snapshot.elements.map((element) => [element.role, element.name]),
    [
      ["button", "Save document"],
      ["textbox", "Email"],
      ["checkbox", "Remember me"],
      ["link", "Next page"],
      ["heading", "Snapshot fixture"],
    ],
  );
  assert.equal(snapshot.elements[1]?.value, "person@example.test");
  assert.equal(snapshot.elements[1]?.disabled, true);
  assert.equal(snapshot.elements[2]?.checked, false);
});

test("refs are opaque, stable and distinct for repeated role/name pairs", () => {
  const nodes = [
    node("button", "Save"),
    node("button", "Save"),
    node("textbox", "Email"),
  ];
  const first = buildSnapshot(nodes, page);
  const second = buildSnapshot(nodes, page);

  assert.deepEqual(
    first.elements.map((element) => element.ref),
    second.elements.map((element) => element.ref),
    "an unchanged tree must return identical refs",
  );
  assert.notEqual(first.elements[0]?.ref, first.elements[1]?.ref);
  for (const element of first.elements) {
    assert.match(element.ref, /^e[0-9a-f]{16}$/);
    assert.equal(element.ref.includes(element.name), false);
    assert.equal(element.ref.includes(element.role), false);
  }
});

test("snapshot caps the number of elements and reports truncation", () => {
  const nodes = Array.from({ length: SNAPSHOT_MAX_ELEMENTS + 50 }, (_, index) =>
    node("button", `Action ${index}`),
  );
  const snapshot = buildSnapshot(nodes, page);

  assert.equal(snapshot.elements.length, SNAPSHOT_MAX_ELEMENTS);
  assert.equal(snapshot.truncated, true);
});

test("snapshot caps long names and the serialized byte budget", () => {
  const longName = "n".repeat(SNAPSHOT_MAX_NAME_LENGTH + 50);
  const nodes = Array.from({ length: SNAPSHOT_MAX_ELEMENTS }, (_, index) =>
    node("button", `${index}-${longName}`),
  );
  const snapshot = buildSnapshot(nodes, page);
  const serialized = Buffer.byteLength(JSON.stringify({ elements: snapshot.elements }), "utf8");

  assert.equal(snapshot.truncated, true);
  assert(serialized <= SNAPSHOT_MAX_BYTES, `snapshot used ${serialized} bytes`);
  for (const element of snapshot.elements) {
    assert(element.name.length <= SNAPSHOT_MAX_NAME_LENGTH);
  }
});

test("unnamed interactive roles stay; unnamed non-interactive roles do not", () => {
  const snapshot = buildSnapshot(
    [node("button", ""), node("heading", ""), node("img", "")],
    page,
  );

  assert.deepEqual(
    snapshot.elements.map((element) => element.role),
    ["button"],
  );
});
