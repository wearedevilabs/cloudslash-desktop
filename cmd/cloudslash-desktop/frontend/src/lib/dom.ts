/**
 * A very small hyperscript helper.
 *
 * The views are built from real DOM nodes rather than HTML strings so that
 * resource IDs, ARNs and property values coming out of the scanner are set as
 * text, never parsed as markup. A maliciously named S3 bucket should not be able
 * to inject anything into this UI.
 */

export type Child = Node | string | number | null | undefined | false;

type Attrs = Record<string, unknown>;

/**
 * The event attributes this helper wires up.
 *
 * HTML attribute names are case-insensitive, so `onclick` and `onClick` are the
 * same attribute but not the same string. Matching a known set accepts both, and
 * leaves a mistyped event name inert here rather than silently dead at the call
 * site.
 */
const EVENT_NAMES = new Set([
  "click",
  "change",
  "input",
  "blur",
  "focus",
  "keydown",
  "keyup",
  "keypress",
  "submit",
  "dblclick",
  "mouseenter",
  "mouseleave",
  "mouseover",
  "mouseout",
  "contextmenu",
]);

function isHandler(key: string): boolean {
  if (!key.startsWith("on") || key.length <= 2) return false;
  return EVENT_NAMES.has(key.slice(2).toLowerCase());
}

function applyAttrs(el: Element, attrs: Attrs): void {
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;

    if (isHandler(key)) {
      // "onclick" -> "click"
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
      continue;
    }

    switch (key) {
      case "class":
        el.setAttribute("class", String(value));
        break;
      case "style":
        if (typeof value === "object") {
          for (const [prop, v] of Object.entries(value as Attrs)) {
            (el as HTMLElement).style.setProperty(prop, String(v));
          }
        } else {
          el.setAttribute("style", String(value));
        }
        break;
      case "dataset":
        for (const [prop, v] of Object.entries(value as Attrs)) {
          (el as HTMLElement).dataset[prop] = String(v);
        }
        break;
      case "text":
        el.textContent = String(value);
        break;
      case "value":
        (el as HTMLInputElement).value = String(value);
        break;
      case "checked":
        (el as HTMLInputElement).checked = Boolean(value);
        break;
      default:
        el.setAttribute(key, value === true ? "" : String(value));
    }
  }
}

function append(parent: Element | DocumentFragment, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) applyAttrs(el, attrs);
  append(el, children);
  return el;
}

/** SVG needs its own namespace, so it gets its own constructor. */
export function s<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: Child[]
): SVGElementTagNameMap[K] {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  if (attrs) applyAttrs(el, attrs);
  append(el, children);
  return el;
}

export function frag(...children: Child[]): DocumentFragment {
  const f = document.createDocumentFragment();
  append(f, children);
  return f;
}

/** Replace every child of `parent` with `children`. */
export function mount(parent: Element, ...children: Child[]): void {
  parent.replaceChildren();
  append(parent, children);
}

/** Set text only when it changed, so we don't thrash layout on each poll. */
export function setText(el: Element | null, value: string): void {
  if (el && el.textContent !== value) el.textContent = value;
}

export function byId<T extends HTMLElement = HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

/** Convenience for the `text` attribute used throughout the components. */
export function textNode(value: string, cls?: string): HTMLSpanElement {
  return h("span", cls ? { class: cls } : null, value);
}
