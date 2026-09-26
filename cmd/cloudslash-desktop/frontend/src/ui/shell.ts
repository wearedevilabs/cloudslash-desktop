import { h, setText } from "../lib/dom";
import { clockTime, money, num, plural } from "../lib/format";
import { LINKS } from "../lib/links";
import { dismissToast, openExternal, refreshPlan, runScan, setScreen, showSuppressed, state, toast, type ScreenID } from "../lib/state";
import { brandMark, icon, type IconName } from "./icons";
import { button, setButtonLabel } from "./bits";
import type { Part } from "./contracts";

/* ============================================================ masthead === */

const SCREENS: Array<{ id: ScreenID; index: string; label: string; icon: IconName }> = [
  { id: "statement", index: "01", label: "Statement", icon: "statement" },
  { id: "register", index: "02", label: "Register", icon: "register" },
  { id: "topology", index: "03", label: "Topology", icon: "topology" },
  { id: "artifacts", index: "04", label: "Artifacts", icon: "artifacts" },
  { id: "account", index: "05", label: "Account", icon: "account" },
  { id: "settings", index: "06", label: "Settings", icon: "filter" },
];

export function screenIndex(id: ScreenID): string {
  return SCREENS.find((s) => s.id === id)?.index ?? "01";
}

export function screenLabel(id: ScreenID): string {
  return SCREENS.find((s) => s.id === id)?.label ?? "Statement";
}

export function createMasthead(): Part {
  const regionValue = h("span", { class: "fact__v" }, "—");
  const sourceValue = h("span", { class: "fact__v" }, "—");
  const scannedValue = h("span", { class: "fact__v" }, "—");
  const nodesValue = h("span", { class: "fact__v" }, "—");
  const lamp = h("span", { class: "lamp lamp--ready" }, "Ready");

  // Preview mode means the Go service never answered. That is a failure of the
  // whole point of the app, so it gets said out loud on every screen instead of
  // quietly rendering synthetic numbers as if they were someone's account.
  const previewChip = h(
    "button",
    {
      class: "tag tag--alarm",
      type: "button",
      title: "The engine did not answer; these figures are synthetic. Click for detail.",
      hidden: true,
      onclick: () =>
        toast(
          "error",
          "Preview data: the engine is not connected",
          "This window is showing a synthetic account. It happens when the interface is opened outside the desktop app, for example by loading the built files in a browser. Launch the CloudSlash desktop binary and the engine is there, in the same process, with nothing to configure.",
          { label: "Get support", url: LINKS.support },
        ),
    },
    "preview data",
  );

  const scanButton = button({
    label: "Run scan",
    icon: "play",
    variant: "primary",
    onClick: () => void runScan(),
  });

  const fact = (key: string, value: HTMLElement) =>
    h("span", { class: "fact" }, h("span", { class: "fact__k" }, key), value);

  const el = h(
    "header",
    { class: "masthead" },
    h(
      "div",
      { class: "masthead__brand" },
      brandMark(19, "masthead__mark"),
      h("span", { class: "masthead__word" }, "Cloud", h("em", {}, "Slash")),
    ),
    h(
      "div",
      { class: "masthead__facts" },
      fact("region", regionValue),
      fact("source", sourceValue),
      fact("scanned", scannedValue),
      fact("nodes", nodesValue),
    ),
    h("div", { class: "masthead__actions" }, previewChip, lamp, scanButton),
  );

  function update(): void {
    const { snapshot, prefs, scanning, mode } = state;

    previewChip.hidden = mode !== "preview";

    setText(regionValue, prefs.Region || snapshot.Region || "—");
    setText(sourceValue, mode === "preview" ? "preview" : prefs.Demo ? "demo" : "live");
    setText(scannedValue, snapshot.FinishedAt ? clockTime(snapshot.FinishedAt) : clockTime(snapshot.StartedAt));
    setText(nodesValue, snapshot.TotalNodes ? num(snapshot.TotalNodes) : "—");

    const lampState =
      snapshot.Status === "scanning"
        ? { cls: "lamp lamp--live", label: "Scanning" }
        : snapshot.Status === "failed"
          ? { cls: "lamp lamp--failed", label: "Failed" }
          : snapshot.Status === "complete"
            ? { cls: "lamp lamp--done", label: "Complete" }
            : { cls: "lamp lamp--ready", label: "Ready" };
    lamp.className = lampState.cls;
    setText(lamp, lampState.label);

    scanButton.disabled = scanning;
    setButtonLabel(scanButton, scanning ? "Scanning…" : "Run scan");
  }

  return { el, update };
}

/* ================================================================ rail === */

export function createRail(): Part {
  const items = new Map<ScreenID, HTMLButtonElement>();
  const counts = new Map<ScreenID, HTMLElement>();

  const buttons = SCREENS.map((screen) => {
    const count = h("span", { class: "rail__count", hidden: true }, "0");
    const btn = h(
      "button",
      {
        class: "rail__item",
        type: "button",
        onclick: () => setScreen(screen.id),
      },
      h("span", { class: "rail__num" }, screen.index),
      icon(screen.icon, 15, "rail__icon"),
      h("span", { class: "rail__label" }, screen.label),
      count,
    );
    items.set(screen.id, btn);
    counts.set(screen.id, count);
    return btn;
  });

  const imprint = h("div", { class: "rail__imprint" });
  const versionValue = h("strong", {}, "—");
  const modeValue = h("strong", {}, "—");
  const targetValue = h("strong", {}, "—");

  imprint.append(
    h("span", {}, "build ", versionValue),
    h("span", {}, "data ", modeValue),
    h("span", {}, "target ", targetValue),
  );

  const el = h(
    "nav",
    { class: "rail", "aria-label": "Sections" },
    h("div", { class: "rail__index" }, h("span", { class: "rail__heading" }, "Statement"), ...buttons),
    h("div", { class: "rail__spacer" }),
    imprint,
  );

  function update(): void {
    for (const screen of SCREENS) {
      const btn = items.get(screen.id);
      if (!btn) continue;
      if (state.screen === screen.id) btn.setAttribute("aria-current", "page");
      else btn.removeAttribute("aria-current");
    }

    const findings = counts.get("register");
    const live = (state.snapshot.Findings ?? []).filter((f) => !f.Ignored).length;
    if (findings) {
      if (live > 0) {
        findings.hidden = false;
        setText(findings, String(live));
      } else {
        findings.hidden = true;
      }
    }

    setText(versionValue, state.profile?.Version ?? "dev");
    setText(modeValue, state.mode === "preview" ? "synthetic" : state.prefs.Demo ? "demo" : "live aws");
    setText(targetValue, state.prefs.Region || "—");
  }

  return { el, update };
}

/* ============================================================= balance === */

/**
 * The running total. Always on screen, so the headline figure never sits behind
 * a navigation step.
 */
export function createBalance(): Part {
  const wasteValue = h("span", { class: "balance__figure" });
  const wasteAside = h("span", { class: "balance__aside" });

  const annualValue = h("span", { class: "balance__figure balance__figure--small" });
  const annualAside = h("span", { class: "balance__aside" });

  const resourcesValue = h("span", { class: "balance__figure balance__figure--small" });
  const resourcesAside = h("span", { class: "balance__aside" });

  const findingsValue = h("span", { class: "balance__figure balance__figure--small" });

  // The suppressed count is a way in rather than just a number: it opens the
  // register filtered to the findings it is counting.
  const findingsAside = h("button", {
    class: "balance__aside balance__aside--action",
    type: "button",
    title: "Show the suppressed findings",
    onclick: () => showSuppressed(),
  });

  const progress = h("span", { class: "balance__progress", hidden: true });

  const lead = h(
    "div",
    { class: "balance__cell balance__cell--lead" },
    h("span", { class: "balance__caption" }, "Recoverable, monthly"),
    h("span", { class: "balance__total" }, wasteValue),
    wasteAside,
  );

  const stat = (caption: string, figure: HTMLElement, aside: HTMLElement) =>
    h(
      "div",
      { class: "balance__cell" },
      h("span", { class: "balance__caption" }, caption),
      figure,
      aside,
    );

  const stats = h(
    "div",
    { class: "balance__stats" },
    stat("Annualised", annualValue, annualAside),
    stat("Resources analysed", resourcesValue, resourcesAside),
    stat("Open findings", findingsValue, findingsAside),
  );

  const el = h(
    "section",
    { class: "balance", "aria-label": "Recoverable spend" },
    lead,
    stats,
    progress,
  );

  let tick = 0;

  /**
   * Write a figure, and flash it when the value actually changed. A live scan
   * restates the totals every few hundred milliseconds; without this, the numbers
   * change silently and the operator has to watch for it.
   */
  function setFigure(el: HTMLElement, value: string): void {
    if (el.textContent === value) return;
    el.textContent = value;
    el.classList.remove("balance__figure--changed");
    void el.offsetWidth;
    el.classList.add("balance__figure--changed");
  }

  function update(): void {
    const { snapshot, scanning } = state;

    setFigure(wasteValue, money(snapshot.MonthlyWaste));
    setText(
      wasteAside,
      snapshot.MonthlyWaste > 0
        ? `across ${plural(snapshot.WasteCount, "finding", "findings")}`
        : "nothing detected yet",
    );

    setFigure(annualValue, money(snapshot.MonthlyWaste * 12));
    setText(annualAside, "if left alone");

    setFigure(resourcesValue, num(snapshot.TotalNodes));
    setText(resourcesAside, `${num(snapshot.EdgeCount)} mapping edges`);

    setFigure(findingsValue, num(snapshot.WasteCount));
    findingsAside.disabled = snapshot.IgnoredCount === 0;
    setText(
      findingsAside,
      snapshot.IgnoredCount > 0 ? `${num(snapshot.IgnoredCount)} suppressed` : "none suppressed",
    );

    if (scanning) {
      tick += 0.07;
      progress.hidden = false;
      progress.style.transform = `scaleX(${Math.min(96, 8 + tick * 100) / 100})`;
    } else {
      tick = 0;
      progress.hidden = true;
    }
  }

  return { el, update };
}

/* =============================================================== toast === */

/**
 * Feedback lives in one place. An error stays until it is dismissed, because a
 * failure the operator never saw is a failure they will hit again.
 */
export function createToast(): Part {
  const el = h("div", { class: "toast", role: "status", "aria-live": "polite", hidden: true });
  let timer: number | undefined;
  let lastKey = "";

  function clearTimer(): void {
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
    }
  }

  function update(): void {
    const toast = state.toast;
    if (!toast) {
      el.hidden = true;
      clearTimer();
      lastKey = "";
      return;
    }

    const key = `${toast.kind}:${toast.title}:${toast.body}`;
    if (key === lastKey) return;
    lastKey = key;

    el.hidden = false;
    el.className = `toast toast--${toast.kind}`;
    el.replaceChildren();

    const body = h("div", { class: "toast__body" }, h("span", { class: "toast__title" }, toast.title), h("span", { class: "toast__text" }, toast.body));

    const actions = h("div", { class: "toast__actions" });
    if (toast.link) {
      const link = button({
        label: toast.link.label,
        icon: "external",
        size: "sm",
        variant: "quiet",
        onClick: () => void openExternal(toast.link!.url),
      });
      actions.append(link);
    }
    if (toast.kind === "error") {
      actions.append(
        button({
          label: "Refresh plan",
          icon: "refresh",
          size: "sm",
          variant: "quiet",
          onClick: () => void refreshPlan(),
        }),
      );
    }
    actions.append(
      button({
        label: "Dismiss",
        icon: "close",
        size: "sm",
        variant: "quiet",
        onClick: () => dismissToast(),
      }),
    );

    el.append(body, actions);

    clearTimer();
    if (toast.kind !== "error") {
      timer = window.setTimeout(() => dismissToast(), 7000);
    }
  }

  return { el, update };
}
