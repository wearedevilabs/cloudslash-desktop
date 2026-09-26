import { h } from "../lib/dom";
import { money, moneyCompact } from "../lib/format";

/**
 * Drawn instruments.
 *
 * Colour carries the severity band, so the shape of a chart also shows where the
 * urgent money sits. Anything that is not a severity stays ink or grey.
 *
 * Every bar is a control: hover for exact figures, activate to open those rows
 * in the register.
 */

export type Tone = "critical" | "high" | "medium" | "low" | "neutral";

export interface RankedRow {
  label: string;
  value: number;
  tone?: Tone;
  /** Short trailing text, e.g. a count or a share. */
  aside?: string;
  /** Lines shown in the hover card beneath the headline figure. */
  detail?: Array<[string, string]>;
  /** When present the row becomes a control that opens the register. */
  onSelect?: () => void;
}

/* ------------------------------------------------------------- hover card */

let tip: HTMLElement | null = null;
let tipOwner: Element | null = null;

function tooltip(): HTMLElement {
  if (!tip) {
    tip = h("div", { class: "tip", role: "tooltip", hidden: true });
    document.body.append(tip);

    // The card is placed once rather than tracked, so anything that moves the page
    // underneath it has to take it away. Without this a card survives the surface
    // it belongs to: navigating on a click removes the bar, which never fires
    // mouseleave, and the card is left floating over the next screen.
    window.addEventListener("scroll", () => dismissTip(), true);
    document.addEventListener("pointerdown", () => dismissTip(), true);
  }
  return tip;
}

/** Hide the hover card. Called when the surface it belongs to goes away. */
export function dismissTip(): void {
  if (!tip || tip.hidden) return;
  tip.hidden = true;
  tipOwner = null;
}

function showTip(owner: HTMLElement, title: string, value: string, detail: Array<[string, string]> = []): void {
  const el = tooltip();
  el.replaceChildren(
    h("span", { class: "tip__title" }, title),
    h("span", { class: "tip__value t-figure" }, value),
    ...detail.map(([k, v]) => h("span", { class: "tip__row" }, h("span", { class: "tip__k" }, k), h("span", { class: "tip__v t-figure" }, v))),
  );
  el.hidden = false;
  tipOwner = owner;

  // Place above the bar, centred, and keep it inside the window.
  const target = owner.getBoundingClientRect();
  const box = el.getBoundingClientRect();
  const left = Math.min(Math.max(8, target.left + target.width / 2 - box.width / 2), window.innerWidth - box.width - 8);
  const top = target.top - box.height - 10;
  el.style.setProperty("left", `${left}px`);
  el.style.setProperty("top", `${top < 8 ? target.bottom + 10 : top}px`);
}

function hideTip(owner: Element): void {
  if (!tip || tipOwner !== owner) return;
  tip.hidden = true;
  tipOwner = null;
}

/* ------------------------------------------------------------- ranked bars */

export function rankedBars(rows: RankedRow[]): HTMLElement {
  const max = rows.reduce((m, r) => Math.max(m, r.value), 0) || 1;
  const total = rows.reduce((sum, r) => sum + r.value, 0) || 1;

  return h(
    "div",
    { class: "bars" },
    ...rows.map((row) => {
      const share = `${Math.round((row.value / total) * 100)}%`;
      const tone = row.tone ?? "neutral";

      const el = h(
        row.onSelect ? "button" : "div",
        {
          class: `bar${row.onSelect ? " bar--action" : ""}`,
          ...(row.onSelect ? { type: "button" } : {}),
        },
        h("span", { class: "bar__label", title: row.label }, row.label),
        h(
          "span",
          { class: "bar__track" },
          h("span", {
            class: `bar__fill bar__fill--${tone}`,
            style: { width: `${Math.max(1.5, (row.value / max) * 100)}%` },
          }),
        ),
        h(
          "span",
          { class: "bar__value" },
          moneyCompact(row.value),
          row.aside ? h("span", { class: "bar__share" }, row.aside) : null,
        ),
      );

      const detail: Array<[string, string]> = [["share of total", share], ...(row.detail ?? [])];
      el.addEventListener("mouseenter", () => showTip(el, row.label, money(row.value), detail));
      el.addEventListener("mouseleave", () => hideTip(el));
      el.addEventListener("focus", () => showTip(el, row.label, money(row.value), detail));
      el.addEventListener("blur", () => hideTip(el));
      if (row.onSelect) {
        const activate = row.onSelect;
        el.addEventListener("click", () => {
          dismissTip();
          activate();
        });
      }

      return el;
    }),
  );
}

/* -------------------------------------------------------------- bar chart */

export interface CostPoint {
  label: string;
  value: number;
  tone?: Tone;
  /** Extra colour shown under the name, e.g. a count. */
  note?: string;
  onSelect?: () => void;
}

const SVG_NS = "http://www.w3.org/2000/svg";

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
  text?: string,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Bars for the leading services, tinted by severity, each one a control.
 *
 * No cumulative line and no second axis: the caption states the concentration in
 * words, which is simpler and easier to act on than a chart with two scales.
 */
export function costChart(points: CostPoint[]): SVGSVGElement {
  const max = points.reduce((m, p) => Math.max(m, p.value), 0) || 1;
  const total = points.reduce((sum, p) => sum + p.value, 0) || 1;

  const width = 720;
  const height = 250;
  const left = 6;
  const right = 714;
  const top = 34;
  const bottom = 182;
  const step = (right - left) / Math.max(1, points.length);
  const barWidth = Math.min(58, step * 0.54);

  const svg = el("svg", {
    viewBox: `0 0 ${width} ${height}`,
    class: "chart",
    role: "img",
    "aria-label": chartSummary(points, total),
  });

  svg.append(el("line", { x1: left, x2: right, y1: bottom, y2: bottom, class: "chart__axis" }));

  points.forEach((point, index) => {
    const centre = left + step * index + step / 2;
    const barHeight = Math.max(2, (point.value / max) * (bottom - top));
    const y = bottom - barHeight;

    const bar = el("rect", {
      x: centre - barWidth / 2,
      y,
      width: barWidth,
      height: barHeight,
      class: `chart__bar chart__bar--${point.tone ?? "neutral"}${point.onSelect ? " chart__bar--action" : ""}`,
    });

    // The native SVG title gives a reliable tooltip without any positioning code.
    bar.append(el("title", {}, `${point.label}: ${money(point.value)} (${Math.round((point.value / total) * 100)}% of total)`));

    if (point.onSelect) {
      // Keyboard reachable, because a click target should be a real control.
      bar.setAttribute("tabindex", "0");
      bar.setAttribute("role", "button");
      const activate = point.onSelect;
      bar.addEventListener("click", () => {
        dismissTip();
        activate();
      });
      bar.addEventListener("keydown", (event) => {
        const key = (event as KeyboardEvent).key;
        if (key === "Enter" || key === " ") {
          event.preventDefault();
          activate();
        }
      });
    }

    svg.append(bar);

    svg.append(el("text", { x: centre, y: y - 8, "text-anchor": "middle" }, moneyCompact(point.value)));

    svg.append(
      el(
        "text",
        { x: centre, y: bottom + 21, "text-anchor": "middle" },
        point.label.length > 17 ? `${point.label.slice(0, 16)}…` : point.label,
      ),
    );

    if (point.note) {
      svg.append(el("text", { x: centre, y: bottom + 36, "text-anchor": "middle", class: "chart__note" }, point.note));
    }
  });

  return svg;
}

function chartSummary(points: CostPoint[], total: number): string {
  if (!points.length) return "No recoverable spend to chart.";
  const critical = points.filter((p) => p.tone === "critical");
  const base = `Monthly recoverable spend by service. The largest, ${points[0].label}, is ${money(
    points[0].value,
  )}. These ${points.length} services account for ${money(total)} a month.`;
  return critical.length
    ? `${base} ${critical.length} of them contain findings scored critical.`
    : base;
}

/** How few services carry most of the waste. Used as a caption. */
export function concentration(points: CostPoint[], threshold = 0.8): { count: number; share: number } {
  const total = points.reduce((sum, p) => sum + p.value, 0);
  if (!total) return { count: 0, share: 0 };
  let running = 0;
  let count = 0;
  for (const point of points) {
    running += point.value;
    count += 1;
    if (running / total >= threshold) break;
  }
  return { count, share: running / total };
}
