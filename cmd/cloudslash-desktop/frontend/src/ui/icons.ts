/**
 * Icons, drawn by hand on a 16x16 grid.
 *
 * Deliberately geometric: butt caps, mitre joins, no rounded terminals and no
 * filled circles. A stock rounded icon set would fight the ruled surfaces these
 * sit on and make the whole thing look generated.
 */

type Prim =
  | ["path", { d: string }]
  | ["rect", { x: number; y: number; width: number; height: number; fill?: string }]
  | ["circle", { cx: number; cy: number; r: number }]
  | ["line", { x1: number; y1: number; x2: number; y2: number }];

const FILLED = "currentColor";

const ICONS: Record<string, Prim[]> = {
  /* A statement: ruled lines with the total struck at the foot. */
  statement: [
    ["path", { d: "M4.5 3.5h9M4.5 8h9M4.5 12.5h4.5" }],
    ["rect", { x: 11.5, y: 11.25, width: 2, height: 2, fill: FILLED }],
  ],

  /* A register: rows, each with a mark in the margin. */
  register: [
    ["path", { d: "M6 4h7.5M6 8h7.5M6 12h7.5" }],
    ["rect", { x: 2, y: 3.25, width: 1.5, height: 1.5, fill: FILLED }],
    ["rect", { x: 2, y: 7.25, width: 1.5, height: 1.5, fill: FILLED }],
    ["rect", { x: 2, y: 11.25, width: 1.5, height: 1.5, fill: FILLED }],
  ],

  /* Topology: nodes joined by edges. */
  topology: [
    ["rect", { x: 1.75, y: 1.75, width: 4, height: 4 }],
    ["rect", { x: 10.25, y: 1.75, width: 4, height: 4 }],
    ["rect", { x: 6, y: 10.25, width: 4, height: 4 }],
    ["path", { d: "M5.75 3.75h4.5M4.2 5.75l3 4.5M11.8 5.75l-3 4.5" }],
  ],

  /* Artifacts: a stack of generated files. */
  artifacts: [
    ["path", { d: "M4.5 3.5V1.75h6l2.5 2.5v7.5H4.5z" }],
    ["path", { d: "M10.5 1.75v2.5h2.5" }],
    ["path", { d: "M2.75 5.25v9h8" }],
  ],

  /* Account: a seal, not a person. This is a licence, not a profile. */
  account: [
    ["circle", { cx: 8, cy: 8, r: 6.25 }],
    ["path", { d: "M5.25 8.25l2 2 3.5-3.75" }],
  ],

  play: [["path", { d: "M4.5 2.75l8 5.25-8 5.25z" }]],
  stop: [["rect", { x: 3.5, y: 3.5, width: 9, height: 9, fill: FILLED }]],
  refresh: [
    ["path", { d: "M13.25 8a5.25 5.25 0 1 1-1.6-3.78" }],
    ["path", { d: "M13.5 1.75v3.25h-3.25" }],
  ],
  folder: [["path", { d: "M1.75 12.75V4h4.5l1.5 2h6.5v6.75z" }]],
  download: [
    ["path", { d: "M8 2v7.5" }],
    ["path", { d: "M5 6.75L8 9.75l3-3" }],
    ["path", { d: "M2.5 12.75h11" }],
  ],
  external: [
    ["path", { d: "M8.5 2.25h5.25v5.25" }],
    ["path", { d: "M13.75 2.25L7 9" }],
    ["path", { d: "M12.5 9.75v4H2.25V3.5h4" }],
  ],
  search: [
    ["circle", { cx: 7, cy: 7, r: 4.25 }],
    ["path", { d: "M10.25 10.25l3.5 3.5" }],
  ],
  warn: [
    ["path", { d: "M8 1.75L14.75 13.5H1.25z" }],
    ["path", { d: "M8 6v3.25" }],
    ["rect", { x: 7.25, y: 10.75, width: 1.5, height: 1.5, fill: FILLED }],
  ],
  check: [["path", { d: "M3 8.5l3.5 3.5L13 5" }]],
  lock: [
    ["rect", { x: 3, y: 7, width: 10, height: 7 }],
    ["path", { d: "M5.5 7V5a2.5 2.5 0 0 1 5 0v2" }],
  ],
  copy: [
    ["rect", { x: 5.5, y: 1.75, width: 8.75, height: 9 }],
    ["path", { d: "M10.5 11.5v2.75H1.75V5h2.75" }],
  ],
  arrow: [["path", { d: "M2.5 8h10.5M9.5 4.5L13 8l-3.5 3.5" }]],
  close: [["path", { d: "M3.5 3.5l9 9M12.5 3.5l-9 9" }]],
  clock: [
    ["circle", { cx: 8, cy: 8, r: 6.25 }],
    ["path", { d: "M8 4.25V8l2.75 1.75" }],
  ],
  filter: [["path", { d: "M2 3.5h12L9.25 9v4.5l-2.5-1.5V9z" }]],
  shield: [
    ["path", { d: "M8 1.75l5.5 2v5c0 3-2.3 4.8-5.5 5.5C4.8 13.55 2.5 11.75 2.5 8.75v-5z" }],
  ],

  /* The house cat. Nine lives, which is the same joke as the Lazarus Protocol:
   * nothing here is really gone, it is just waiting to be brought back. */
  cat: [
    ["circle", { cx: 8, cy: 5.6, r: 2.6 }],
    ["path", { d: "M5.9 3.8L6.5 1.5L8.2 3.1" }],
    ["path", { d: "M10.1 3.8L9.5 1.5L7.8 3.1" }],
    ["path", { d: "M5.75 8.4c0 2.9.45 4.6.45 4.6h3.6s.45-1.7.45-4.6" }],
    ["path", { d: "M10.3 12.4c1.5 0 2-1.5 1.35-2.7" }],
  ],
};

export type IconName = keyof typeof ICONS;

export function icon(name: IconName, size = 15, className?: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.2");
  svg.setAttribute("stroke-linecap", "butt");
  svg.setAttribute("stroke-linejoin", "miter");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  if (className) svg.setAttribute("class", className);

  for (const [tag, attrs] of ICONS[name] ?? []) {
    const child = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attrs)) {
      // A filled rect is a solid mark in the margin; it should not also be
      // stroked, or it reads as a tiny boxed checkbox.
      if (tag === "rect" && key === "fill") child.setAttribute("stroke", "none");
      child.setAttribute(key, String(value));
    }
    svg.append(child);
  }
  return svg;
}

/**
 * The product mark: four ruled lines narrowing to a single struck line, which
 * is what the tool does to waste. Drawn, not a letter in a rounded square.
 */
export function brandMark(size = 18, className?: string): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 18 18");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("stroke-linecap", "butt");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  if (className) svg.setAttribute("class", className);

  const rules: Array<[number, number, number]> = [
    [1, 16, 3.2],
    [1, 12.5, 6.6],
    [1, 9, 10],
  ];
  for (const [x1, x2, y] of rules) {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(x1));
    line.setAttribute("x2", String(x2));
    line.setAttribute("y1", String(y));
    line.setAttribute("y2", String(y));
    line.setAttribute("stroke", "currentColor");
    svg.append(line);
  }

  const mark = document.createElementNS("http://www.w3.org/2000/svg", "line");
  mark.setAttribute("x1", "1");
  mark.setAttribute("x2", "6");
  mark.setAttribute("y1", "13.4");
  mark.setAttribute("y2", "13.4");
  mark.setAttribute("stroke", "var(--waste)");
  mark.setAttribute("stroke-width", "3");
  svg.append(mark);

  return svg;
}
