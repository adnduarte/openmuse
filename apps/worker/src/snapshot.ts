import { createHash } from "node:crypto";

/**
 * Bounded accessibility snapshot for the agent computer.
 *
 * The worker never exposes raw DOM or selectors: callers receive opaque `ref`
 * values derived from the accessibility role/name plus a stable ordinal. The
 * refs are deterministic for an unchanged tree and are meant to be used with
 * the accompanying `snapshotId`.
 */

export interface SnapshotAxNode {
  ignored?: boolean;
  role?: { value?: unknown };
  name?: { value?: unknown };
  value?: { value?: unknown };
  properties?: Array<{ name?: string; value?: { value?: unknown } }>;
  /** CDP backend DOM node id, used only inside the worker to mark the DOM. */
  backendDOMNodeId?: number;
}

export interface SnapshotElement {
  ref: string;
  role: string;
  name: string;
  value?: string;
  type?: string;
  disabled?: boolean;
  checked?: boolean;
}

export interface SnapshotBody {
  url: string;
  title: string;
  truncated: boolean;
  elements: SnapshotElement[];
}

/** Internal mapping used to mark the DOM element that owns each ref. */
export interface SnapshotTarget {
  ref: string;
  backendDOMNodeId: number;
}

export interface SnapshotBuild {
  snapshot: SnapshotBody;
  targets: SnapshotTarget[];
}

export const SNAPSHOT_MAX_ELEMENTS = 200;
export const SNAPSHOT_MAX_NAME_LENGTH = 200;
export const SNAPSHOT_MAX_VALUE_LENGTH = 300;
/** Serialized element budget (UTF-8 bytes); keeps the API response bounded. */
export const SNAPSHOT_MAX_BYTES = 48 * 1024;

/** Structural nodes that add noise without giving the agent an actionable target. */
const STRUCTURAL_ROLES = new Set([
  "generic",
  "none",
  "presentation",
  "statictext",
  "inlinetextbox",
  "linebreak",
  "rootwebarea",
  "paragraph",
  "listmarker",
  "separation",
]);

/** Roles that stay in the snapshot even when they have no accessible name. */
const INTERACTIVE_ROLES = new Set([
  "button",
  "checkbox",
  "combobox",
  "gridcell",
  "link",
  "listbox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
  "treeitem",
]);

function textValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function booleanValue(value: unknown): boolean | undefined {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return undefined;
}

function property(node: SnapshotAxNode, name: string): unknown {
  const entry = node.properties?.find((item) => item.name === name);
  return entry?.value?.value;
}

function stableRef(role: string, name: string, ordinal: number): string {
  // Opacity: the role/name never leaves the worker; the digest is the ref.
  return `e${createHash("sha256")
    .update(`${role}\u0000${name}\u0000${ordinal}`, "utf8")
    .digest("hex")
    .slice(0, 16)}`;
}

function boundedText(
  raw: string,
  max: number,
  state: { truncated: boolean },
): string {
  const value = raw.replace(/\s+/g, " ").trim();
  if (value.length <= max) return value;
  state.truncated = true;
  return value.slice(0, max);
}

/**
 * Converts a CDP accessibility tree into the worker snapshot contract and
 * returns the internal DOM targets used to mark `data-juxa-ref`.
 *
 * `snapshotId` is supplied by the caller (the browser manager keeps a
 * per-process monotonic counter); refs are derived only from the tree, so two
 * consecutive snapshots of an unchanged page return identical refs.
 */
export function buildSnapshotWithTargets(
  nodes: readonly SnapshotAxNode[],
  options: {
    url: string;
    title: string;
  },
): SnapshotBuild {
  const state = { truncated: false };
  const elements: SnapshotElement[] = [];
  const targets = new Map<string, SnapshotTarget>();
  const ordinals = new Map<string, number>();
  let bytes = 0;

  for (const node of nodes) {
    if (node.ignored === true) continue;
    const role = textValue(node.role?.value).trim().toLowerCase();
    if (role === "" || STRUCTURAL_ROLES.has(role)) continue;

    const rawName = textValue(node.name?.value);
    const interactive = INTERACTIVE_ROLES.has(role);
    if (rawName.trim() === "" && !interactive) continue;

    const name = boundedText(rawName, SNAPSHOT_MAX_NAME_LENGTH, state);
    const key = `${role}\u0000${name}`;
    const ordinal = ordinals.get(key) ?? 0;
    ordinals.set(key, ordinal + 1);

    const element: SnapshotElement = {
      ref: stableRef(role, name, ordinal),
      role,
      name,
    };
    const rawValue = textValue(node.value?.value);
    if (rawValue !== "") element.value = boundedText(rawValue, SNAPSHOT_MAX_VALUE_LENGTH, state);
    const disabled = booleanValue(property(node, "disabled"));
    if (disabled === true) element.disabled = true;
    const checked = booleanValue(property(node, "checked"));
    if (checked !== undefined) element.checked = checked;

    const elementBytes = Buffer.byteLength(JSON.stringify(element), "utf8");
    if (
      elements.length >= SNAPSHOT_MAX_ELEMENTS ||
      bytes + elementBytes > SNAPSHOT_MAX_BYTES
    ) {
      state.truncated = true;
      break;
    }
    bytes += elementBytes;
    elements.push(element);
    if (
      typeof node.backendDOMNodeId === "number" &&
      Number.isInteger(node.backendDOMNodeId) &&
      node.backendDOMNodeId > 0
    ) {
      targets.set(element.ref, {
        ref: element.ref,
        backendDOMNodeId: node.backendDOMNodeId,
      });
    }
  }

  // JSON array separators are not part of each element's own byte count.
  while (
    elements.length > 0 &&
    Buffer.byteLength(JSON.stringify({ elements }), "utf8") > SNAPSHOT_MAX_BYTES
  ) {
    elements.pop();
    state.truncated = true;
  }

  const refs = new Set(elements.map((element) => element.ref));
  return {
    snapshot: {
      url: options.url,
      title: options.title,
      truncated: state.truncated,
      elements,
    },
    targets: [...targets.values()].filter((target) => refs.has(target.ref)),
  };
}

/**
 * Converts a CDP accessibility tree into the worker snapshot contract.
 *
 * Kept as the pure, list-only entry point used by tests and callers that do
 * not need DOM targets.
 */
export function buildSnapshot(
  nodes: readonly SnapshotAxNode[],
  options: {
    url: string;
    title: string;
  },
): SnapshotBody {
  return buildSnapshotWithTargets(nodes, options).snapshot;
}
