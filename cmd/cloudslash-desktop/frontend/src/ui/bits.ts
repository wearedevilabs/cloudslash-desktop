import { h, setText } from "../lib/dom";
import { money, num, severity, valueOr } from "../lib/format";
import { icon, type IconName } from "./icons";

/**
 * The shared vocabulary: severity marks, statement panels, field rows, notes.
 * Every surface is assembled from these so the ledger reads consistently.
 */

/** Severity is a filled square plus a word. Never colour alone. */
export function severityMark(risk: number): HTMLElement {
  const s = severity(risk);
  return h("span", { class: `sev sev--${s.key}`, title: `Risk score ${risk} of 100` }, s.label);
}

export function scoreRuler(score: number): HTMLElement {
  const s = severity(score);
  const ticks: HTMLElement[] = [];
  const filled = Math.round(Math.min(100, Math.max(0, score)) / 10);
  for (let i = 0; i < 10; i++) {
    const on = i < filled;
    ticks.push(h("span", { class: `ruler__tick${on ? ` ruler__tick--on ruler__tick--${s.key}` : ""}` }));
  }
  return h("span", { class: "ruler", role: "img", "aria-label": `Risk ${score} of 100, ${s.label}` }, ...ticks);
}

export interface ButtonOptions {
  label: string;
  icon?: IconName;
  variant?: "primary" | "danger" | "quiet" | "default";
  size?: "sm" | "default";
  block?: boolean;
  title?: string;
  disabled?: boolean;
  onClick?: () => void;
}

export function button(options: ButtonOptions): HTMLButtonElement {
  const classes = ["btn"];
  if (options.variant && options.variant !== "default") classes.push(`btn--${options.variant}`);
  if (options.size === "sm") classes.push("btn--sm");
  if (options.block) classes.push("btn--block");

  return h(
    "button",
    {
      class: classes.join(" "),
      type: "button",
      title: options.title ?? options.label,
      disabled: options.disabled ?? false,
      onclick: options.onClick,
    },
    options.icon ? icon(options.icon, 13, "btn__icon") : null,
    h("span", { class: "btn__label" }, options.label),
  );
}

/** Change a button's label without disturbing its icon. */
export function setButtonLabel(btn: HTMLButtonElement, label: string): void {
  const span = btn.querySelector(".btn__label");
  if (span) setText(span, label);
  else btn.textContent = label;
}

/** Show a short busy label for the duration of an async action. */
export async function withBusyLabel(
  btn: HTMLButtonElement,
  busy: string,
  work: () => Promise<unknown>,
): Promise<void> {
  const original = btn.querySelector(".btn__label")?.textContent ?? "";
  const wasDisabled = btn.disabled;
  btn.disabled = true;
  setButtonLabel(btn, busy);
  try {
    await work();
  } finally {
    setButtonLabel(btn, original);
    btn.disabled = wasDisabled;
  }
}

/** A panel is a ruled section: stamped label, title, then content. */
export function panel(options: {
  title: string;
  note?: string;
  /** Nulls are allowed so callers can build the body inline without branching. */
  body: Node | Array<Node | null>;
  quiet?: boolean;
  action?: Node;
}): HTMLElement {
  const head = h(
    "div",
    { class: "panel__head" },
    h("h2", { class: "panel__title" }, options.title),
    options.note ? h("span", { class: "panel__note" }, options.note) : null,
    options.action ?? null,
  );
  const bodies = Array.isArray(options.body) ? options.body : [options.body];
  return h("section", { class: `panel${options.quiet ? " panel--quiet" : ""}` }, head, ...bodies);
}

export function field(options: {
  label: string;
  control: Node;
  hint?: string;
  forId?: string;
}): HTMLElement {
  return h(
    "label",
    { class: "field", for: options.forId },
    h("span", { class: "field__label" }, options.label),
    options.control,
    options.hint ? h("span", { class: "field__hint" }, options.hint) : null,
  );
}

/** label . . . . . . value — set by hand, the way a statement is. */
export function leaderRow(key: string, value: string, mono = false): HTMLElement {
  return h(
    "div",
    { class: "leader" },
    h("span", { class: "leader__k" }, key),
    h("span", { class: "leader__dots" }),
    h("span", { class: `leader__v${mono ? " t-figure" : ""}` }, value),
  );
}

export function kvRow(key: string, value: string | Node): HTMLElement {
  return h("div", { class: "kv__row" }, h("span", { class: "kv__k" }, key), h("span", { class: "kv__v" }, value));
}

export function tag(label: string, kind?: "pro" | "safe" | "soft"): HTMLElement {
  return h("span", { class: `tag${kind ? ` tag--${kind}` : ""}` }, label);
}

export function note(
  kind: "info" | "warn" | "err" | "safe" | "plain",
  title: string,
  body: string | Node,
  action?: Node,
): HTMLElement {
  const cls = kind === "plain" ? "note" : `note note--${kind}`;
  return h(
    "div",
    { class: cls, role: kind === "err" ? "alert" : undefined },
    h("div", { class: "note__body" }, h("span", { class: "note__title" }, title), h("span", {}, body)),
    action ?? null,
  );
}

export function emptyState(title: string, body: string, action?: Node): HTMLElement {
  return h("div", { class: "empty" }, h("span", { class: "empty__title" }, title), h("span", { class: "empty__body" }, body), action ?? null);
}

export function skeleton(width: string): HTMLElement {
  return h("span", { class: "skeleton", style: { width } });
}

/** A definition row for the inspector's spec sheet. */
export function specRow(key: string, value: string | Node): HTMLElement {
  return h("div", { class: "kv__row" }, h("span", { class: "kv__k" }, key), h("span", { class: "kv__v" }, value));
}

export function codeValue(value: string): HTMLElement {
  return h("span", { class: "id selectable" }, value);
}

export function plainValue(value: string, fallback = "—"): string {
  return valueOr(value, fallback);
}

/** A money figure, always tabular so columns line up down the page. */
export function figure(value: number): HTMLElement {
  return h("span", { class: "t-figure" }, money(value));
}

export function countLabel(n: number): HTMLElement {
  return h("span", { class: "t-figure" }, num(n));
}
