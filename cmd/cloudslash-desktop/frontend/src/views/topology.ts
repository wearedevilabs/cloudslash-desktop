import { h } from "../lib/dom";
import { byRegion, byService, filterToRegister, state } from "../lib/state";
import { money, moneyCompact, num, plural } from "../lib/format";
import { emptyState, note, panel } from "../ui/bits";
import { rankedBars } from "../ui/charts";
import type { View } from "../ui/contracts";

/**
 * Topology: how the recoverable spend is distributed across services and
 * regions. The graph itself is not shown, only where its cost concentrates.
 */
export function createTopologyView(): View {
  const el = h("div", { class: "view" });
  const inner = h("div", { class: "view__inner" });
  el.append(inner);

  function update(): void {
    const { snapshot } = state;
    const findings = (snapshot.Findings ?? []).filter((f) => !f.Ignored);

    const sections: Node[] = [
      h("div", { class: "view__title" }, h("h1", {}, "Topology"), h("span", { class: "t-stamp" }, "distribution")),
      h(
        "p",
        { class: "view__lede" },
        "The same money, read by service and by region. Concentration is what makes waste tractable.",
      ),
    ];

    if (!findings.length) {
      sections.push(
        emptyState(
          "Nothing mapped yet",
          "Once a scan completes, this page shows where the waste accumulates across services and regions.",
        ),
      );
      inner.replaceChildren(...sections);
      return;
    }

    const services = byService();
    const regions = byRegion();

    sections.push(
      panel({
        title: "By service",
        note: money(snapshot.MonthlyWaste),
        body: rankedBars(
          services.map((service) => ({
            label: service.name,
            value: service.cost,
            tone: service.worst,
            aside: `${num(service.count)}×`,
            detail: [
              ["findings", num(service.count)],
              ["critical", num(service.criticalCount)],
              ["critical cost", moneyCompact(service.criticalCost)],
            ],
            onSelect: () => filterToRegister(service.name),
          })),
        ),
      }),
    );

    sections.push(
      panel({
        title: "By region",
        body: rankedBars(
          regions.map((region) => ({
            label: region.region,
            value: region.cost,
            aside: `${num(region.count)}×`,
            onSelect: () => filterToRegister(region.region),
          })),
        ),
      }),
    );

    const density = snapshot.TotalNodes ? snapshot.EdgeCount / snapshot.TotalNodes : 0;
    sections.push(
      panel({
        title: "The graph behind this",
        note: snapshot.Partial ? "partial coverage" : "complete coverage",
        body: h(
          "p",
          { class: "stat-strip" },
          `${num(snapshot.TotalNodes)} resources`,
          ` · ${num(snapshot.EdgeCount)} edges`,
          ` · ${density.toFixed(1)} per resource`,
          ` · ${num(snapshot.WasteCount)} open`,
          ` · ${num(snapshot.IgnoredCount)} suppressed`,
          ` · ${num(regions.length)} regions`,
        ),
      }),
    );

    const critical = findings.filter((f) => f.Risk >= 80);
    if (critical.length) {
      const criticalCost = critical.reduce((sum, f) => sum + f.Cost, 0);
      sections.push(
        note(
          "warn",
          `${plural(critical.length, "finding is", "findings are")} scored critical, worth ${moneyCompact(
            criticalCost,
          )} a month`,
          "The engine rated these above 80: confident the resource is unattached, idle or orphaned. They are the first five minutes of any clean-up.",
        ),
      );
    }

    inner.replaceChildren(...sections);
  }

  update();
  return { el, update };
}
