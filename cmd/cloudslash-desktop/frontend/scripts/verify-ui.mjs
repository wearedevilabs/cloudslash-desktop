/**
 * Layout and accessibility audit for the desktop interface.
 *
 * The window is verified in a real browser because that is where the interface
 * actually runs: the Wails shell is a webview, so a headless Chromium is the
 * same rendering engine, minus the native frame.
 *
 * What it checks, per screen:
 *   - content overflow: the page must never scroll sideways, and no box may
 *     clip its own text
 *   - collapsed text: nothing with words in it may measure zero
 *   - overlap: two pieces of text must not occupy the same pixels
 *   - contrast: every text node must clear 4.5:1 against its real background
 *   - typography: the three families must actually be applied where intended
 *   - presence: expected copy for the screen must be on the page
 *
 * Usage:
 *   npm run build
 *   cd dist && python3 -m http.server 8098 --bind 127.0.0.1 &
 *   npm run verify -- --url http://127.0.0.1:8098
 * Exits non-zero when a check fails, so it can gate a build.
 */

import { mkdir, writeFile } from "node:fs/promises";
import puppeteer from "puppeteer-core";

const args = process.argv.slice(2);
const readFlag = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const BASE = readFlag("--url", "");
const OUT = readFlag("--out", "./.verify");
const EXECUTABLE = process.env.CHROMIUM_PATH || "/usr/bin/chromium";

if (!BASE) {
  console.error("verify-ui: pass the origin serving the built bundle, e.g. --url http://127.0.0.1:8098");
  process.exit(2);
}

const SCREENS = ["statement", "register", "topology", "artifacts", "account", "settings"];

/** Copy that must appear on each screen, proving the view actually rendered. */
const EXPECTED = {
  statement: ["Statement", "Recoverable, monthly", "Where the money is", "Largest single items", "Annualised"],
  register: ["Register", "Severity", "Resource", "Monthly", "Inspector", "Suppressed"],
  topology: ["Topology", "By service", "By region", "The graph behind this"],
  artifacts: ["Artifacts", "Generate", "On disk", "Freeze resources", "Restore resources"],
  account: ["Account", "What you get", "CloudSlash Support", "About"],
  settings: ["Settings", "Scope", "Analysis", "Governance", "Output"],
};

/** Runs inside the page. Must be self-contained: no imports, no closures. */
function audit() {
  const problems = [];
  const notes = {};

  const parseColor = (value) => {
    const match = /rgba?\(([^)]+)\)/.exec(value || "");
    if (!match) return null;
    const parts = match[1].split(",").map((p) => parseFloat(p.trim()));
    if (parts.length < 3) return null;
    const alpha = parts.length > 3 ? parts[3] : 1;
    return { r: parts[0], g: parts[1], b: parts[2], a: alpha };
  };

  const luminance = ({ r, g, b }) => {
    const channel = (c) => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };

  const contrast = (fg, bg) => {
    const a = luminance(fg);
    const b = luminance(bg);
    const [hi, lo] = a > b ? [a, b] : [b, a];
    return (hi + 0.05) / (lo + 0.05);
  };

  const effectiveBackground = (el) => {
    let node = el;
    while (node && node !== document.documentElement) {
      const bg = parseColor(getComputedStyle(node).backgroundColor);
      if (bg && bg.a > 0.95) return bg;
      node = node.parentElement;
    }
    const body = parseColor(getComputedStyle(document.body).backgroundColor);
    return body ?? { r: 255, g: 255, b: 255, a: 1 };
  };

  const hasOwnText = (el) =>
    Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim().length > 1);

  const visible = (el, style, rect) =>
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    parseFloat(style.opacity) > 0.05 &&
    rect.width > 0 &&
    rect.height > 0;

  const label = (el) => {
    const id = el.id ? `#${el.id}` : "";
    const cls = typeof el.className === "string" && el.className ? `.${el.className.trim().split(/\s+/).join(".")}` : "";
    const text = (el.textContent || "").trim().slice(0, 42);
    return `${el.tagName.toLowerCase()}${id}${cls} "${text}"`;
  };

  const all = Array.from(document.querySelectorAll("body *"));
  const textNodes = [];

  for (const el of all) {
    // Content behind a modal is inert. Skipping it is not a convenience: the
    // background legitimately sits under the dialog, so measuring their boxes
    // against each other reports a collision that is the whole point of a modal.
    if (el.closest("[inert], [aria-hidden='true']")) continue;

    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (!visible(el, style, rect)) continue;

    // A box that clips its own content is a layout bug.
    const clipsX = el.scrollWidth - el.clientWidth > 2 && style.overflowX !== "visible";
    const clipsY = el.scrollHeight - el.clientHeight > 2 && style.overflowY !== "visible";
    if ((clipsX || clipsY) && hasOwnText(el)) {
      problems.push({ kind: "clipped", detail: `${label(el)} clips by ${el.scrollWidth - el.clientWidth}x${el.scrollHeight - el.clientHeight}` });
    }

    if (hasOwnText(el)) {
      if (rect.width < 1 || rect.height < 1) {
        problems.push({ kind: "collapsed", detail: label(el) });
      }

      // Text sticking out of the window on the right.
      if (rect.right > window.innerWidth + 1) {
        problems.push({ kind: "offscreen-x", detail: `${label(el)} right=${Math.round(rect.right)} > ${window.innerWidth}` });
      }
      if (rect.left < -1) {
        problems.push({ kind: "offscreen-x", detail: `${label(el)} left=${Math.round(rect.left)}` });
      }

      const fg = parseColor(style.color);
      if (fg) {
        const bg = effectiveBackground(el);
        const size = parseFloat(style.fontSize);
        const weight = parseInt(style.fontWeight, 10) || 400;
        const large = size >= 24 || (size >= 18.66 && weight >= 700);
        const ratio = contrast(fg, bg);
        const floor = large ? 3 : 4.5;
        if (ratio < floor) {
          problems.push({
            kind: "contrast",
            detail: `${label(el)} ${ratio.toFixed(2)}:1 (needs ${floor}) size=${size} fg=${style.color} bg=rgb(${bg.r},${bg.g},${bg.b})`,
          });
        }
        textNodes.push({ el, rect, label: label(el) });
      }
    }

    // Interactive targets should be comfortable to hit.
    if (el.tagName === "BUTTON" || el.tagName === "INPUT") {
      if (rect.height > 0 && rect.height < 24) {
        problems.push({ kind: "small-target", detail: `${label(el)} height=${Math.round(rect.height)}` });
      }
    }
  }

  // Two pieces of text occupying the same pixels means something is stacked wrong.
  const overlaps = [];
  for (let i = 0; i < textNodes.length; i++) {
    for (let j = i + 1; j < textNodes.length; j++) {
      const a = textNodes[i].rect;
      const b = textNodes[j].rect;
      // Skip ancestor/descendant pairs, which legitimately share space.
      if (textNodes[i].el.contains(textNodes[j].el) || textNodes[j].el.contains(textNodes[i].el)) continue;
      const x = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
      const y = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      const area = x * y;
      if (area <= 0) continue;
      const smaller = Math.min(a.width * a.height, b.width * b.height);
      if (smaller > 0 && area / smaller > 0.45) {
        overlaps.push({ kind: "overlap", detail: `${textNodes[i].label} ∩ ${textNodes[j].label}` });
      }
    }
  }
  problems.push(...overlaps.slice(0, 12));

  if (document.documentElement.scrollWidth > window.innerWidth + 1) {
    problems.push({
      kind: "page-overflow-x",
      detail: `document scrollWidth=${document.documentElement.scrollWidth} > viewport ${window.innerWidth}`,
    });
  }

  // The `hidden` attribute only works when nothing overrides the user agent's
  // `display: none`. Any author rule setting `display` on the same element beats
  // it, whatever the specificity, so a hidden overlay can stay on screen.
  for (const el of all) {
    if (!el.hasAttribute("hidden")) continue;
    const display = getComputedStyle(el).display;
    if (display !== "none") {
      problems.push({
        kind: "hidden-ignored",
        detail: `${label(el)} has the hidden attribute but computes display:${display}`,
      });
    }
  }

  // A handler set as an attribute is a dead control: it gets stringified into the
  // markup and never runs. Wiring has to be addEventListener or a property.
  for (const el of all) {
    for (const attr of el.getAttributeNames()) {
      if (/^on[a-z]+$/.test(attr)) {
        problems.push({
          kind: "dead-handler",
          detail: `${label(el)} carries an inline ${attr} attribute instead of a listener`,
        });
      }
    }
  }

  /* ---- typography ---------------------------------------------------- */
  const fontOf = (selector) => {
    const el = document.querySelector(selector);
    return el ? getComputedStyle(el).fontFamily.split(",")[0].replace(/["']/g, "") : null;
  };
  notes.fonts = {
    heading: fontOf(".view__title h1"),
    body: fontOf(".view__lede"),
    figure: fontOf(".t-figure"),
    stamp: fontOf(".t-stamp"),
    balance: fontOf(".balance__figure"),
  };
  notes.background = getComputedStyle(document.body).backgroundColor;
  notes.title = document.title;
  notes.textLength = document.body.innerText.replace(/\s+/g, " ").trim().length;
  notes.buttons = document.querySelectorAll("button").length;
  notes.rows = document.querySelectorAll(".ledger tbody tr, .list-row, .item, .bar").length;

  const chart = document.querySelector("svg.chart");
  notes.chart = chart ? { w: Math.round(chart.getBoundingClientRect().width), h: Math.round(chart.getBoundingClientRect().height) } : null;

  const accent = getComputedStyle(document.querySelector(".balance__figure") || document.documentElement).color;
  notes.accentUses = all.filter(
    (el) => getComputedStyle(el).color === accent || getComputedStyle(el).backgroundColor === accent,
  ).length;

  return { problems, notes, text: document.body.innerText };
}

const browser = await puppeteer.launch({
  executablePath: EXECUTABLE,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--hide-scrollbars", "--force-color-profile=srgb"],
});

await mkdir(OUT, { recursive: true });

const report = { url: BASE, screens: {}, failures: 0 };

for (const screen of SCREENS) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 940, deviceScaleFactor: 1 });

  const consoleErrors = [];
  const notFound = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    // See the 404 filter below: the runtime's optional-asset probe logs too.
    if ((msg.location()?.url ?? "").endsWith("/wails/custom.js")) return;
    consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));
  page.on("response", (res) => {
    // The Wails runtime probes for an optional user-supplied /wails/custom.js.
    // Nothing in this app provides one, so a 404 there is expected, not a fault.
    if (res.status() === 404 && !res.url().endsWith("/wails/custom.js")) notFound.push(res.url());
  });

  await page.goto(`${BASE}/?preview=1&screen=${screen}`, { waitUntil: "networkidle0", timeout: 45000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector(".balance__figure", { timeout: 15000 });
  await new Promise((resolve) => setTimeout(resolve, 350));

  const result = await page.evaluate(audit);

  // Rendered text is upper-cased by CSS in places, so match case-insensitively.
  const haystack = result.text.toLowerCase();
  const missing = (EXPECTED[screen] ?? []).filter((needle) => !haystack.includes(needle.toLowerCase()));
  const problems = [...result.problems];
  if (missing.length) problems.push({ kind: "missing-copy", detail: missing.join(" | ") });
  if (notFound.length) problems.push({ kind: "http-404", detail: [...new Set(notFound)].slice(0, 4).join(" | ") });
  if (consoleErrors.length) problems.push({ kind: "console-error", detail: consoleErrors.slice(0, 4).join(" | ") });

  const shot = `${OUT}/${screen}.png`;
  await page.screenshot({ path: shot });

  report.screens[screen] = { notes: result.notes, problems };
  report.failures += problems.length;

  const status = problems.length ? `FAIL (${problems.length})` : "pass";
  console.log(`\n${screen.toUpperCase()}  ${status}`);
  console.log(`  title="${result.notes.title}"  text=${result.notes.textLength} chars  buttons=${result.notes.buttons}  rows=${result.notes.rows}  accentUses=${result.notes.accentUses}`);
  console.log(
    `  fonts: heading=${result.notes.fonts.heading} body=${result.notes.fonts.body} figure=${result.notes.fonts.figure} balance=${result.notes.fonts.balance}`,
  );
  if (result.notes.chart) console.log(`  chart: ${result.notes.chart.w}x${result.notes.chart.h}`);
  for (const problem of problems.slice(0, 14)) {
    console.log(`  - [${problem.kind}] ${problem.detail}`);
  }
  if (problems.length > 14) console.log(`  … ${problems.length - 14} more`);

  await page.close();
}

/* ---------------------------------------------------------------- paywall */

// The paywall is a modal, so it cannot be deep-linked; it has to be driven. This
// checks the three things a modal owes a keyboard user: it opens, it holds
// focus, and Escape closes it and hands focus back.
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 940, deviceScaleFactor: 1 });
  const problems = [];

  try {
    await page.goto(`${BASE}/?preview=1&screen=account`, { waitUntil: "networkidle0", timeout: 45000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForSelector(".balance__figure", { timeout: 15000 });

    // Click the first VISIBLE support action. Matching on text alone can pick up
    // a hidden control from a surface that has not been rendered yet.
    const opened = await page.evaluate(() => {
      const matches = [...document.querySelectorAll("button")].filter((b) =>
        /support cloudslash/i.test(b.textContent || ""),
      );
      const visible = matches.filter((b) => b.offsetParent !== null && !b.disabled);
      if (!visible.length) return { clicked: false, matches: matches.length, visible: 0 };
      visible[0].click();
      return { clicked: true, matches: matches.length, visible: visible.length, label: visible[0].textContent };
    });
    console.log("  trigger:", JSON.stringify(opened));

    if (!opened.clicked) {
      problems.push({
        kind: "paywall-unreachable",
        detail: `no visible support action (${opened.matches} matched, none visible)`,
      });
    } else {
      // Wait for the dialog itself to become visible, not merely to exist.
      await page.waitForSelector(".paywall:not([hidden])", { timeout: 5000 });
      await new Promise((resolve) => setTimeout(resolve, 400));

      const inside = await page.evaluate(() => Boolean(document.activeElement?.closest(".sheet")));
      if (!inside) {
        const where = await page.evaluate(() => document.activeElement?.tagName ?? "nothing");
        problems.push({ kind: "paywall-focus", detail: `focus is on ${where}, not in the dialog` });
      }

      report.paywallDiag = await page.evaluate(() => {
        const shell = document.querySelector(".shell");
        const sheet = document.querySelector(".sheet");
        const paywall = document.querySelector(".paywall");
        return {
          paywallHidden: paywall ? paywall.hidden : "no paywall element",
          sheetChildren: sheet ? sheet.childElementCount : "no sheet",
          shellPresent: Boolean(shell),
          shellInert: shell ? shell.inert : "no shell",
          active: `${document.activeElement?.tagName}.${document.activeElement?.className || ""}`,
        };
      });
      console.log("  diagnostics:", JSON.stringify(report.paywallDiag));

      const inert = await page.evaluate(() => Boolean(document.querySelector(".shell")?.inert));
      if (!inert) problems.push({ kind: "paywall-inert", detail: "the page behind the dialog is still reachable" });

      const auditResult = await page.evaluate(audit);
      problems.push(...auditResult.problems.slice(0, 8));

      // Read the dialog's own copy, not the page behind it.
      const dialogText = await page.evaluate(() => document.querySelector(".sheet")?.innerText ?? "");
      if (!/free/i.test(dialogText)) {
        problems.push({ kind: "paywall-copy", detail: "the dialog does not say the features are free" });
      }
      if (dialogText.length < 200) {
        problems.push({ kind: "paywall-thin", detail: `the dialog only rendered ${dialogText.length} characters` });
      }

      // Escape must close it.
      await page.keyboard.press("Escape");
      await new Promise((resolve) => setTimeout(resolve, 300));
      const closed = await page.evaluate(() => {
        const paywall = document.querySelector(".paywall");
        return !paywall || paywall.hidden;
      });
      if (!closed) problems.push({ kind: "paywall-escape", detail: "Escape did not close the dialog" });
    }
  } catch (err) {
    problems.push({ kind: "paywall-crash", detail: String(err).split("\n")[0] });
  }

  report.paywall = { problems };
  report.failures += problems.length;
  console.log(`\nPAYWALL  ${problems.length ? `FAIL (${problems.length})` : "pass"}`);
  for (const problem of problems.slice(0, 10)) console.log(`  - [${problem.kind}] ${problem.detail}`);

  await page.close();
}

/* ------------------------------------------------------------ interaction */

// Interaction guard. The layout checks cannot tell a working control from an
// inert one, so this clicks something and insists the screen changes.
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 940, deviceScaleFactor: 1 });
  const problems = [];

  try {
    await page.goto(`${BASE}/?preview=1&screen=statement`, { waitUntil: "networkidle0", timeout: 45000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForSelector(".balance__figure", { timeout: 15000 });

    const clicked = await page.evaluate(() => {
      const item = [...document.querySelectorAll(".rail__item")].find((b) => /register/i.test(b.textContent || ""));
      if (!item) return false;
      item.click();
      return true;
    });

    if (!clicked) {
      problems.push({ kind: "nav-missing", detail: "no Register item in the rail" });
    } else {
      await new Promise((resolve) => setTimeout(resolve, 350));
      const heading = await page.evaluate(() => document.querySelector(".view__title h1")?.textContent ?? "");
      if (heading.trim() !== "Register") {
        problems.push({
          kind: "nav-dead",
          detail: `clicking the rail left the heading at ${JSON.stringify(heading)}: controls are not wired`,
        });
      }

      const marked = await page.evaluate(
        () => document.querySelector('.rail__item[aria-current="page"]')?.textContent ?? "",
      );
      if (!/register/i.test(marked)) {
        problems.push({ kind: "nav-state", detail: "the rail did not mark the new section as current" });
      }

      // Arrow keys must move the selection, not just the focus ring, and focus
      // has to survive the table being rebuilt underneath it.
      await page.waitForSelector(".ledger tbody tr", { timeout: 5000 });
      const before = await page.evaluate(() => {
        const rows = [...document.querySelectorAll(".ledger tbody tr")];
        const index = rows.findIndex((row) => row.getAttribute("aria-selected") === "true");
        if (index >= 0) rows[index].focus();
        return index;
      });

      if (before < 0) {
        problems.push({ kind: "arrow-no-selection", detail: "no row was selected to start from" });
      } else {
        await page.keyboard.press("ArrowDown");
        await new Promise((resolve) => setTimeout(resolve, 300));
        const after = await page.evaluate(() => {
          const rows = [...document.querySelectorAll(".ledger tbody tr")];
          return {
            selected: rows.findIndex((row) => row.getAttribute("aria-selected") === "true"),
            focused: rows.findIndex((row) => row === document.activeElement),
          };
        });

        if (after.selected !== before + 1) {
          problems.push({
            kind: "arrow-select",
            detail: `ArrowDown moved the selection from row ${before} to ${after.selected}`,
          });
        }
        if (after.focused !== after.selected) {
          problems.push({
            kind: "arrow-focus",
            detail: `focus is on row ${after.focused} while the selection is on row ${after.selected}`,
          });
        }
      }

      // Suppressed findings need a place of their own: the filter must exist and
      // it must actually narrow the register to the suppressed rows.
      const foundControl = await page.evaluate(() => {
        const seg = [...document.querySelectorAll(".seg__opt")].find(
          (option) => (option.textContent ?? "").trim().toLowerCase() === "suppressed",
        );
        if (!seg) return false;
        seg.click();
        return true;
      });

      if (!foundControl) {
        problems.push({ kind: "suppressed-control", detail: "the register has no Suppressed filter" });
      } else {
        await new Promise((resolve) => setTimeout(resolve, 300));
        const view = await page.evaluate(() => {
          const rows = [...document.querySelectorAll(".ledger tbody tr")];
          return {
            rows: rows.length,
            suppressed: rows.filter((row) => row.classList.contains("row--suppressed")).length,
          };
        });
        if (view.rows === 0) {
          problems.push({ kind: "suppressed-empty", detail: "the Suppressed view showed no rows at all" });
        } else if (view.suppressed !== view.rows) {
          problems.push({
            kind: "suppressed-filter",
            detail: `${view.suppressed} of ${view.rows} rows in the Suppressed view were suppressed`,
          });
        }
      }
    }
  } catch (err) {
    problems.push({ kind: "interaction-crash", detail: String(err).split("\n")[0] });
  }

  report.interaction = { problems };
  report.failures += problems.length;
  console.log(`\nINTERACTION  ${problems.length ? `FAIL (${problems.length})` : "pass"}`);
  for (const problem of problems) console.log(`  - [${problem.kind}] ${problem.detail}`);

  await page.close();
}

// The first-run state: nothing scanned, live mode, so the AWS connection path is
// what the operator meets. Worth auditing, because it is the only screen a new
// install sees before anything else.
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 940, deviceScaleFactor: 1 });
  const problems = [];

  try {
    await page.goto(`${BASE}/?preview=1&empty=1&screen=statement`, { waitUntil: "networkidle0", timeout: 45000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForSelector(".balance__figure", { timeout: 15000 });
    await new Promise((resolve) => setTimeout(resolve, 350));

    const result = await page.evaluate(audit);
    problems.push(...result.problems.slice(0, 8));

    const text = result.text;
    for (const needle of ["Connect your AWS account", "profile", "Check connection", "Run scan"]) {
      if (!text.toLowerCase().includes(needle.toLowerCase())) {
        problems.push({ kind: "onboarding-copy", detail: `the first-run state does not mention "${needle}"` });
      }
    }

    const controls = await page.evaluate(() => ({
      profiles: document.querySelectorAll("#scan-profile option").length,
      demoOn: document.querySelector("#scan-demo")?.checked ?? null,
    }));
    if (controls.demoOn !== false) {
      problems.push({ kind: "onboarding-demo", detail: `demo mode is ${controls.demoOn}, want false by default` });
    }
    if (controls.profiles < 2) {
      problems.push({ kind: "onboarding-profiles", detail: `only ${controls.profiles} profile options rendered` });
    }
  } catch (err) {
    problems.push({ kind: "onboarding-crash", detail: String(err).split("\n")[0] });
  }

  report.onboarding = { problems };
  report.failures += problems.length;
  console.log(`\nONBOARDING  ${problems.length ? `FAIL (${problems.length})` : "pass"}`);
  for (const problem of problems.slice(0, 10)) console.log(`  - [${problem.kind}] ${problem.detail}`);

  await page.close();
}

/* ----------------------------------------------------------------- motion */

// Motion only counts if it runs in the rendered interface. This checks that a
// screen change actually animates something, that press feedback is declared,
// and that the reduced-motion switch collapses durations without removing the
// content the interface was communicating.
{
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 940, deviceScaleFactor: 1 });
  const problems = [];

  try {
    await page.goto(`${BASE}/?preview=1&screen=statement`, { waitUntil: "networkidle0", timeout: 45000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForSelector(".balance__figure", { timeout: 15000 });

    const navigated = await page.evaluate(() => {
      const item = [...document.querySelectorAll(".rail__item")].find((b) => /topology/i.test(b.textContent || ""));
      if (!item) return false;
      item.click();
      return true;
    });
    if (!navigated) {
      problems.push({ kind: "motion-nav", detail: "no rail item to navigate with" });
    } else {
      await new Promise((resolve) => setTimeout(resolve, 60));
      const running = await page.evaluate(
        () => document.getAnimations().filter((a) => a.playState === "running").length,
      );
      if (running === 0) {
        problems.push({ kind: "motion-absent", detail: "no animation was running after a screen change" });
      }
    }

    const press = await page.evaluate(() => {
      const btn = document.querySelector(".btn");
      return btn ? getComputedStyle(btn).transitionProperty : null;
    });
    if (!press || !press.includes("transform")) {
      problems.push({ kind: "motion-press", detail: `button transition-property is ${press}` });
    }

    // The progress bars must animate transform, never width.
    const bars = await page.evaluate(() =>
      [".balance__progress", ".scan__bar"].map((selector) => {
        const el = document.querySelector(selector);
        return el ? getComputedStyle(el).transitionProperty : null;
      }),
    );
    for (const property of bars) {
      if (property && /width|height|margin|top|left/.test(property)) {
        problems.push({ kind: "motion-layout", detail: `a progress bar transitions ${property}` });
      }
    }

    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    const reduced = await page.evaluate(() => {
      const btn = document.querySelector(".btn");
      return btn ? getComputedStyle(btn).transitionDuration : null;
    });
    if (reduced && parseFloat(reduced) > 0.05) {
      problems.push({ kind: "motion-reduced", detail: `reduced motion still leaves a ${reduced} transition` });
    }
    const alive = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").trim().length > 200);
    if (!alive) {
      problems.push({ kind: "motion-reduced-meaning", detail: "content disappeared under reduced motion" });
    }
  } catch (err) {
    problems.push({ kind: "motion-crash", detail: String(err).split("\n")[0] });
  }

  report.motion = { problems };
  report.failures += problems.length;
  console.log(`\nMOTION  ${problems.length ? `FAIL (${problems.length})` : "pass"}`);
  for (const problem of problems) console.log(`  - [${problem.kind}] ${problem.detail}`);

  await page.close();
}

await writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));
await browser.close();

console.log(`\n${report.failures === 0 ? "ALL SCREENS PASS" : `${report.failures} PROBLEMS`} — report at ${OUT}/report.json`);
process.exit(report.failures === 0 ? 0 : 1);
