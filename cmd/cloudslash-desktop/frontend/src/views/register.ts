import { h } from "../lib/dom";
import {
  filteredFindings,
  ignoreFinding,
  openExternal,
  selectFinding,
  selectedFinding,
  setFilter,
  state,
} from "../lib/state";
import { LINKS } from "../lib/links";
import { friendlyType, money, num, plural, propValue, severity, shortID, valueOr } from "../lib/format";
import { button, emptyState, panel, scoreRuler, severityMark, specRow } from "../ui/bits";
import { icon } from "../ui/icons";
import type { View } from "../ui/contracts";
import type { Finding } from "../lib/types";

/**
 * The register: every finding as a line item, with an inspector for whichever
 * one is selected. Dense and keyboard-navigable, and built on a real table so
 * assistive technology can read it.
 */
export function createRegisterView(): View {
  const el = h("div", { class: "view" });
  const inner = h("div", { class: "view__inner" });
  el.append(inner);

  const toolbar = buildToolbar();
  const body = h("div", { class: "register" });
  const inspectorHost = h("div", { class: "register__inspector" });

  // Set when a keystroke moves the selection, so the rebuilt row can take focus.
  let focusAfterRender: string | null = null;

  inner.append(
    h("div", { class: "view__title" }, h("h1", {}, "Register"), h("span", { class: "t-stamp" }, "line items")),
    h(
      "p",
      { class: "view__lede" },
      "Each row is one resource that is being paid for and not used. Select a row to see the evidence behind the flag.",
    ),
    toolbar.el,
    body,
  );

  body.append(h("div", { class: "register__table" }), inspectorHost);

  function update(): void {
    toolbar.update();
    renderTable();
    renderInspector();
  }

  function renderTable(): void {
    const host = body.firstElementChild as HTMLElement;
    const rows = filteredFindings();
    host.replaceChildren();

    if (!state.snapshot.Findings?.length) {
      host.append(
        emptyState(
          "Nothing to register",
          "Run a scan and every resource the engine could not justify will be listed here with its cost and risk.",
        ),
      );
      return;
    }

    if (!rows.length) {
      const onlySuppressed = state.filters.suppressed === "suppressed";
      host.append(
        emptyState(
          onlySuppressed ? "Nothing is suppressed" : "No rows match",
          onlySuppressed
            ? "Suppressing a finding keeps it in the graph but takes it out of the totals. Nothing has been suppressed in this scan."
            : "The search and severity filters exclude every finding. Widen them to see the register again.",
          button({
            label: onlySuppressed ? "Back to active findings" : "Clear filters",
            icon: "close",
            onClick: () => setFilter({ query: "", severity: "all", suppressed: "active" }),
          }),
        ),
      );
      return;
    }

    const table = h("table", { class: "ledger ledger--interactive" });
    table.append(
      h(
        "thead",
        {},
        h(
          "tr",
          {},
          h("th", { scope: "col" }, "Severity"),
          h("th", { scope: "col" }, "Resource"),
          h("th", { scope: "col" }, "Region"),
          h("th", { scope: "col", class: "num" }, "Risk"),
          h("th", { scope: "col", class: "num" }, "Monthly"),
        ),
      ),
    );

    const tbody = h("tbody", {});
    const selected = selectedFinding();

    rows.forEach((finding) => {
      const isSelected = Boolean(selected && selected.ID === finding.ID);
      const tr = h(
        "tr",
        {
          tabindex: "0",
          "aria-selected": isSelected ? "true" : "false",
          title: "Select this finding",
          dataset: { findingId: finding.ID },
        },
        h("td", {}, severityMark(finding.Risk)),
        h(
          "td",
          {},
          h("span", { class: "id selectable" }, shortID(finding.ID)),
          h("span", { class: "sub" }, `${friendlyType(finding.Type)} · ${valueOr(finding.Owner, "unassigned")}`),
        ),
        h("td", { class: "t-figure" }, valueOr(finding.Region, "global")),
        h("td", { class: "num" }, String(finding.Risk)),
        h("td", { class: "num num--lead" }, money(finding.Cost)),
      );

      if (finding.Ignored) tr.classList.add("row--suppressed");

      tr.addEventListener("click", () => selectFinding(finding.ID));
      tr.addEventListener("keydown", (event) => {
        const key = (event as KeyboardEvent).key;

        if (key === "Enter" || key === " ") {
          event.preventDefault();
          selectFinding(finding.ID);
          return;
        }
        if (key === "ArrowDown" || key === "ArrowUp") {
          event.preventDefault();
          stepSelection(finding.ID, key === "ArrowDown" ? 1 : -1);
          return;
        }
        if (key === "Home" || key === "End") {
          event.preventDefault();
          selectEdge(key === "Home");
        }
      });

      tbody.append(tr);
    });

    table.append(tbody);
    host.append(table);
    restoreRowFocus(tbody);
  }

  /**
   * Move the selection by one row. Arrows move the selection rather than only the
   * focus ring, so the inspector keeps up with the keyboard.
   */
  function stepSelection(currentId: string, delta: number): void {
    const list = filteredFindings();
    const index = list.findIndex((row) => row.ID === currentId);
    if (index < 0) return;

    const next = list[index + delta];
    if (!next) return;

    focusAfterRender = next.ID;
    selectFinding(next.ID);
  }

  function selectEdge(first: boolean): void {
    const list = filteredFindings();
    const next = first ? list[0] : list[list.length - 1];
    if (!next) return;

    focusAfterRender = next.ID;
    selectFinding(next.ID);
  }

  /**
   * The table is rebuilt from scratch on every selection, so the row to focus is
   * remembered by id and restored afterwards. Holding an element reference would
   * not survive the rebuild, and focus would land back on the document.
   */
  function restoreRowFocus(tbody: HTMLElement): void {
    if (!focusAfterRender) return;
    const wanted = focusAfterRender;
    focusAfterRender = null;

    const row = [...tbody.querySelectorAll<HTMLTableRowElement>("tr")].find(
      (candidate) => candidate.dataset.findingId === wanted,
    );
    if (!row) return;

    row.focus();
    // Keep the active row on screen when walking a long register.
    row.scrollIntoView({ block: "nearest" });
  }

  function renderInspector(): void {
    inspectorHost.replaceChildren();
    const finding = selectedFinding();

    if (!finding) {
      inspectorHost.append(
        panel({
          title: "Inspector",
          quiet: true,
          body: h(
            "p",
            { class: "t-small" },
            state.snapshot.Findings?.length
              ? "Select a row to inspect it."
              : "Nothing is selected because nothing has been found yet.",
          ),
        }),
      );
      return;
    }

    inspectorHost.append(inspectorPanel(finding));
  }

  return { el, update };
}

/* ---------------------------------------------------------------------- */

function inspectorPanel(finding: Finding): HTMLElement {
  const band = severity(finding.Risk);
  const properties = Object.entries(finding.Properties ?? {}).sort(([a], [b]) => a.localeCompare(b));

  const header = h(
    "div",
    { class: "inspector__head" },
    h("span", { class: "inspector__id selectable" }, shortID(finding.ID)),
    finding.Ignored ? h("span", { class: "stamp" }, "Suppressed") : null,
  );

  const moneyBlock = h(
    "div",
    { class: "inspector__money" },
    h(
      "div",
      {},
      h("span", { class: "t-stamp" }, "per month"),
      h("span", { class: "inspector__figure t-figure is-waste" }, money(finding.Cost)),
    ),
    h(
      "div",
      {},
      h("span", { class: "t-stamp" }, "per year"),
      h("span", { class: "inspector__figure t-figure" }, money(finding.Cost * 12)),
    ),
  );

  const scoreBlock = h(
    "div",
    { class: "inspector__score" },
    h("div", { class: "row--between" }, severityMark(finding.Risk), h("span", { class: "t-figure" }, `${finding.Risk}/100`)),
    scoreRuler(finding.Risk),
    h("span", { class: "t-meta" }, `Reachability: ${valueOr(finding.Reachability, "unknown")}`),
  );

  const actions = h(
    "div",
    { class: "row-actions" },
    finding.Ignored
      ? h("span", { class: "t-meta" }, "Excluded from the totals.")
      : button({
          label: "Suppress this finding",
          icon: "check",
          onClick: () => void ignoreFinding(finding.ID),
        }),
    button({
      label: "Copy ID",
      icon: "copy",
      variant: "quiet",
      onClick: () => {
        void navigator.clipboard?.writeText(finding.ID);
      },
    }),
  );

  const why = h(
    "blockquote",
    { class: "inspector__why" },
    valueOr(finding.Reason, "Flagged by waste detection heuristics. The engine did not record a written reason for this resource."),
  );

  return panel({
    title: "Inspector",
    note: band.label.toLowerCase(),
    body: [
      header,
      why,
      moneyBlock,
      scoreBlock,
      h(
        "div",
        { class: "kv" },
        specRow("Type", friendlyType(finding.Type)),
        specRow("Type id", h("span", { class: "t-figure selectable" }, finding.Type)),
        specRow("Region", valueOr(finding.Region, "global")),
        specRow("Owner", valueOr(finding.Owner, "unassigned")),
        specRow("Suppressed", finding.Ignored ? "yes" : "no"),
      ),
      properties.length
        ? h(
            "details",
            { class: "inspector__props" },
            h("summary", {}, `Raw properties (${num(properties.length)})`),
            h(
              "div",
              { class: "kv" },
              ...properties.map(([key, value]) =>
                specRow(key, h("span", { class: "t-figure selectable" }, propValue(value))),
              ),
            ),
          )
        : null,
      actions,
      button({
        label: "How findings are decided",
        icon: "external",
        variant: "quiet",
        size: "sm",
        onClick: () => void openExternal(LINKS.docs),
      }),
    ],
  });
}

/* ---------------------------------------------------------------------- */

function buildToolbar() {
  const search = h("input", {
    id: "register-search",
    type: "search",
    placeholder: "Filter by id, type, region or owner",
    autocomplete: "off",
    spellcheck: "false",
    value: state.filters.query,
  });
  search.addEventListener("input", () => setFilter({ query: search.value }));

  const searchBox = h(
    "div",
    { class: "search" },
    icon("search", 14, "search__icon"),
    search,
  );

  const countLabel = h("span", { class: "toolbar__count t-figure" }, "—");

  const severityOptions: Array<{ id: typeof state.filters.severity; label: string }> = [
    { id: "all", label: "All" },
    { id: "critical", label: "Critical" },
    { id: "high", label: "High+" },
    { id: "medium", label: "Medium+" },
  ];
  const sortOptions: Array<{ id: typeof state.filters.sort; label: string }> = [
    { id: "cost", label: "Cost" },
    { id: "risk", label: "Risk" },
    { id: "name", label: "Name" },
  ];

  const severitySeg = buildSeg(severityOptions, () => state.filters.severity, (id) => setFilter({ severity: id }));
  const sortSeg = buildSeg(sortOptions, () => state.filters.sort, (id) => setFilter({ sort: id }));

  // Suppression is orthogonal to severity, so it gets its own control rather
  // than being folded into the severity bands.
  const suppressionOptions: Array<{ id: typeof state.filters.suppressed; label: string }> = [
    { id: "active", label: "Active" },
    { id: "suppressed", label: "Suppressed" },
    { id: "all", label: "Both" },
  ];
  const suppressionSeg = buildSeg(
    suppressionOptions,
    () => state.filters.suppressed,
    (id) => setFilter({ suppressed: id }),
  );

  const el = h(
    "div",
    { class: "toolbar" },
    searchBox,
    h("span", { class: "toolbar__group" }, h("span", { class: "t-stamp" }, "Severity"), severitySeg.el),
    h("span", { class: "toolbar__group" }, h("span", { class: "t-stamp" }, "Sort"), sortSeg.el),
    h("span", { class: "toolbar__group" }, h("span", { class: "t-stamp" }, "Findings"), suppressionSeg.el),
    countLabel,
  );

  function update(): void {
    if (document.activeElement !== search) search.value = state.filters.query;
    severitySeg.update();
    sortSeg.update();
    suppressionSeg.update();
    const total = state.snapshot.Findings?.length ?? 0;
    const shown = filteredFindings().length;
    countLabel.textContent = shown === total ? `${plural(total, "row", "rows")}` : `${num(shown)} of ${num(total)} rows`;
  }

  return { el, update };
}

function buildSeg<T extends string>(
  options: Array<{ id: T; label: string }>,
  read: () => T,
  write: (id: T) => void,
) {
  const buttons = new Map<T, HTMLButtonElement>();
  const el = h(
    "span",
    { class: "seg", role: "group" },
    ...options.map((option) => {
      const btn = h(
        "button",
        { class: "seg__opt", type: "button", onclick: () => write(option.id) },
        option.label,
      );
      buttons.set(option.id, btn);
      return btn;
    }),
  );

  function update(): void {
    const current = read();
    for (const [id, btn] of buttons) {
      btn.setAttribute("aria-pressed", id === current ? "true" : "false");
    }
  }

  return { el, update };
}
