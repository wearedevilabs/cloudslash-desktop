import { h } from "../lib/dom";
import {
  byRegion,
  byService,
  chooseProfile,
  filterToRegister,
  loadAwsProfiles,
  runScan,
  savePrefs,
  setScreen,
  state,
  verifyAws,
} from "../lib/state";
import { friendlyType, money, moneyCompact, num, plural, pct, shortID, valueOr } from "../lib/format";
import { button, emptyState, leaderRow, note, panel, setButtonLabel, severityMark } from "../ui/bits";
import { concentration, costChart } from "../ui/charts";
import type { View } from "../ui/contracts";

/** Six is the most a reader can rank at a glance; the register holds the rest. */
const CHART_SERVICES = 6;
const TOP_ITEMS = 5;

/**
 * The statement: the headline account of what is recoverable, where it is
 * concentrated, and the largest single items behind the number.
 *
 * The scan controls are one command bar; the rest of the engine configuration
 * lives on the Settings screen.
 */
export function createStatementView(): View {
  const el = h("div", { class: "view" });
  const inner = h("div", { class: "view__inner" });
  el.append(inner);

  // The command bar persists across updates so the region field keeps focus
  // while a scan reports progress every few hundred milliseconds.
  const bar = buildScanBar();
  const dataHost = h("div", {});

  inner.append(
    h(
      "div",
      { class: "view__title" },
      h("h1", {}, "Statement"),
      h("span", { class: "t-stamp" }, "recoverable spend"),
    ),
    h(
      "p",
      { class: "view__lede" },
      "Everything the scan could prove is being paid for and not used, priced at what it costs you this month.",
    ),
    bar.el,
    dataHost,
  );

  function update(): void {
    bar.update();
    render();
  }

  function render(): void {
    const { snapshot, mode } = state;
    const findings = (snapshot.Findings ?? []).filter((f) => !f.Ignored);

    dataHost.replaceChildren();

    if (snapshot.Status === "failed") {
      dataHost.append(
        note(
          "err",
          "The scan did not finish",
          snapshot.Error || "The engine returned an error before it produced a graph.",
          button({ label: "Try again", icon: "refresh", size: "sm", onClick: () => void runScan() }),
        ),
      );
      return;
    }

    if (snapshot.Status === "ready" || (snapshot.Status === "scanning" && findings.length === 0)) {
      dataHost.append(onboarding());
      return;
    }

    /* -- where the money is ------------------------------------------- */
    const services = byService();
    const points = services.slice(0, CHART_SERVICES).map((service) => ({
      label: service.name,
      value: service.cost,
      tone: service.worst,
      note: `${num(service.count)}×`,
      onSelect: () => filterToRegister(service.name),
    }));
    const focus = concentration(services.map((s) => ({ label: s.name, value: s.cost })));

    dataHost.append(
      panel({
        title: "Where the money is",
        note: `${num(services.length)} ${services.length === 1 ? "service" : "services"}`,
        body: [
          points.length ? costChart(points) : null,
          points.length
            ? h(
                "p",
                { class: "caption" },
                `The largest ${plural(focus.count, "service carries", "services carry")} ${pct(
                  focus.share * 100,
                  100,
                )} of it. Fix those first; the rest is a long tail.`,
              )
            : h("p", { class: "t-small" }, "No recoverable spend was found in this scan."),
        ],
      }),
    );

    /* -- the largest single items ------------------------------------- */
    const largest = [...findings].sort((a, b) => b.Cost - a.Cost).slice(0, TOP_ITEMS);
    dataHost.append(
      panel({
        title: "Largest single items",
        note: "by monthly cost",
        action: button({
          label: "Open register",
          icon: "arrow",
          size: "sm",
          variant: "quiet",
          onClick: () => setScreen("register"),
        }),
        body: largest.length
          ? h(
              "div",
              { class: "items" },
              ...largest.map((f) =>
                h(
                  "div",
                  { class: "item" },
                  severityMark(f.Risk),
                  h(
                    "div",
                    { class: "item__main" },
                    h("span", { class: "item__id selectable" }, shortID(f.ID)),
                    h("span", { class: "item__why" }, valueOr(f.Reason, "Flagged by waste detection heuristics")),
                  ),
                  h(
                    "div",
                    { class: "item__meta" },
                    h("span", { class: "t-figure item__cost" }, money(f.Cost)),
                    h("span", { class: "t-stamp" }, `${friendlyType(f.Type)} · ${valueOr(f.Region, "global")}`),
                  ),
                ),
              ),
            )
          : h("p", { class: "t-small" }, "Nothing was flagged."),
      }),
    );

    /* -- the account itself ------------------------------------------- */
    const regions = byRegion();
    const accountRows: Node[] = [
      leaderRow("Resources analysed", num(snapshot.TotalNodes)),
      leaderRow("Mapping edges", num(snapshot.EdgeCount)),
      leaderRow("Open findings", num(snapshot.WasteCount)),
      leaderRow("Suppressed", num(snapshot.IgnoredCount)),
      leaderRow("Regions touched", num(regions.length)),
      leaderRow("Source", mode === "preview" ? "synthetic preview" : state.prefs.Demo ? "demo mode" : "live AWS"),
    ];

    const regionRows: Node[] = [h("span", { class: "t-stamp section-note" }, "By region")];
    if (regions.length) {
      for (const region of regions.slice(0, 6)) {
        regionRows.push(leaderRow(region.region, `${moneyCompact(region.cost)} · ${num(region.count)}×`));
      }
    } else {
      regionRows.push(h("p", { class: "t-small" }, "No regional split available."));
    }

    dataHost.append(
      panel({
        title: "Account",
        quiet: true,
        body: h("div", { class: "panel__grid" }, h("div", {}, ...accountRows), h("div", {}, ...regionRows)),
      }),
    );

    if (snapshot.Partial) {
      dataHost.append(
        note(
          "warn",
          "This statement has gaps",
          `${num(snapshot.FailedScopeCount)} ${
            snapshot.FailedScopeCount === 1 ? "scope" : "scopes"
          } could not be read, so every figure above is a floor rather than a full account.`,
        ),
      );
    }
  }

  return { el, update };
}

/* ---------------------------------------------------------------------- */

/**
 * The first-run state. Nothing has been read, so this is where the operator is
 * told what a scan will do and given the two ways to start one: a real account
 * through the AWS profile picker above, or synthetic data.
 */
function onboarding(): Node {
  const { prefs, awsProfiles, awsProfilesError, awsIdentity, verifyingAws, scanning } = state;

  if (snapshotIsScanning()) {
    return emptyState(
      "Building the dependency graph",
      "The engine is reading your account. Totals appear here as soon as the first scope lands.",
    );
  }

  if (prefs.Demo) {
    return emptyState(
      "Nothing read yet",
      "Demo mode is on. A scan builds a synthetic account rather than reading yours, so it is safe to run and works offline.",
      button({ label: "Run demo scan", icon: "play", variant: "primary", onClick: () => void runScan() }),
    );
  }

  const body: Node[] = [
    h(
      "p",
      { class: "t-small" },
      "CloudSlash reads through your standard AWS credential chain, the same one the AWS CLI uses. It never asks for a key and never stores one.",
    ),
  ];

  if (awsProfiles.length) {
    body.push(
      h(
        "p",
        { class: "t-small" },
        `${plural(awsProfiles.length, "profile", "profiles")} found on this machine. Pick one in the bar above, then check it before scanning.`,
      ),
    );
  } else {
    body.push(
      note(
        "warn",
        "No AWS profiles were found",
        awsProfilesError || "Create one with `aws configure`, then reopen this window.",
        button({ label: "Re-check", icon: "refresh", size: "sm", variant: "quiet", onClick: () => void loadAwsProfiles() }),
      ),
    );
  }

  if (awsIdentity?.Connected) {
    body.push(
      h(
        "div",
        { class: "kv" },
        leaderRow("Account", awsIdentity.Account, true),
        leaderRow("Profile", awsIdentity.Profile || "default chain", true),
        leaderRow("Region", awsIdentity.Region, true),
      ),
    );
  }

  body.push(
    h(
      "div",
      { class: "row" },
      button({
        label: verifyingAws ? "Checking…" : "Check connection",
        icon: "shield",
        disabled: verifyingAws || !awsProfiles.length,
        onClick: () => void verifyAws(),
      }),
      button({
        label: scanning ? "Scanning…" : "Run scan",
        icon: "play",
        variant: "primary",
        disabled: scanning,
        onClick: () => void runScan(),
      }),
    ),
  );

  return panel({ title: "Connect your AWS account", body });
}

function snapshotIsScanning(): boolean {
  return state.snapshot.Status === "scanning";
}

/* ---------------------------------------------------------------------- */

/** One line of controls: which account, whether to read it for real, and go. */
function buildScanBar() {
  const regionInput = h("input", {
    class: "input input--inline",
    id: "scan-region",
    type: "text",
    value: state.prefs.Region,
    placeholder: "us-east-1",
    autocomplete: "off",
    spellcheck: "false",
    "aria-label": "AWS region",
  });
  regionInput.addEventListener("input", () => {
    state.prefs.Region = regionInput.value.trim();
  });
  regionInput.addEventListener("change", () => void savePrefs({ Region: regionInput.value.trim() || "us-east-1" }));

  const demoInput = h("input", { type: "checkbox", id: "scan-demo", checked: state.prefs.Demo });
  demoInput.addEventListener("change", () => void savePrefs({ Demo: demoInput.checked }));

  const profileSelect = h("select", {
    class: "input input--inline",
    id: "scan-profile",
    "aria-label": "AWS profile",
  });
  profileSelect.addEventListener("change", () => void chooseProfile(profileSelect.value));
  const profileField = h(
    "label",
    { class: "scanbar__field", for: "scan-profile" },
    h("span", { class: "fact__k" }, "profile"),
    profileSelect,
  );

  const verifyButton = button({
    label: "Check",
    icon: "shield",
    variant: "quiet",
    size: "sm",
    onClick: () => void verifyAws(),
  });

  const scanButton = button({ label: "Run scan", icon: "play", variant: "primary", onClick: () => void runScan() });
  const statusText = h("span", { class: "scanbar__status" });
  const progress = h("span", { class: "scan__bar", hidden: true });

  const el = h(
    "div",
    { class: "scanbar" },
    h(
      "label",
      { class: "scanbar__field", for: "scan-region" },
      h("span", { class: "fact__k" }, "region"),
      regionInput,
    ),
    profileField,
    verifyButton,
    h(
      "label",
      { class: "switch scanbar__switch", for: "scan-demo" },
      demoInput,
      h("span", { class: "switch__track" }, h("span", { class: "switch__knob" })),
      h("span", { class: "switch__text" }, "demo"),
    ),
    scanButton,
    statusText,
    progress,
  );

  let ticks = 0;
  let profileSignature = "";

  /** Rebuild the profile options only when the list or the choice changes. */
  function syncProfiles(): void {
    const wanted = state.prefs.Profile;
    const names = state.awsProfiles;
    const signature = `${names.join("|")}::${wanted}`;
    if (signature === profileSignature) return;
    profileSignature = signature;

    profileSelect.replaceChildren(
      h("option", { value: "" }, names.length ? "default chain" : "none found"),
      ...names.map((name) => h("option", { value: name }, name)),
    );
    profileSelect.value = names.includes(wanted) ? wanted : "";
  }

  function update(): void {
    if (document.activeElement !== regionInput) regionInput.value = state.prefs.Region;
    demoInput.checked = state.prefs.Demo;

    // Credentials are irrelevant in demo mode, so the picker and the check are
    // hidden rather than disabled.
    const live = !state.prefs.Demo;
    profileField.hidden = !live;
    verifyButton.hidden = !live;
    verifyButton.disabled = state.verifyingAws || !state.awsProfiles.length;
    if (live) syncProfiles();

    const { scanning } = state;
    scanButton.disabled = scanning;
    setButtonLabel(scanButton, scanning ? "Scanning…" : "Run scan");

    statusText.textContent = statusLine();

    if (scanning) {
      // Creep toward 95%: the engine reports phases, not a percentage, and a bar
      // that reaches 100% and keeps working is a lie.
      ticks += 1;
      progress.hidden = false;
      progress.style.transform = `scaleX(${Math.min(95, 10 + ticks * 6) / 100})`;
    } else {
      ticks = 0;
      progress.hidden = true;
    }
  }

  function statusLine(): string {
    const { snapshot, prefs, scanning } = state;
    if (scanning) return `reading ${prefs.Region} · ${num(snapshot.TotalNodes)} resources so far`;
    if (snapshot.Status === "failed") return `last scan failed: ${snapshot.Error || "unknown error"}`;
    if (snapshot.Status === "complete") {
      return `${num(snapshot.TotalNodes)} resources · ${num(snapshot.WasteCount)} findings · ${money(
        snapshot.MonthlyWaste,
      )} a month${snapshot.Partial ? " · partial" : ""}`;
    }
    return "nothing has been read yet";
  }

  return { el, update };
}
