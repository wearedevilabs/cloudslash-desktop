package main

import (
	"fmt"
	"sort"
	"strings"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/container"
)

// findingsScreen presents a filterable list beside a detail pane.
func (d *Desktop) findingsScreen() fyne.CanvasObject {
	controls := container.NewVBox(
		sectionTitle("WASTE FINDINGS"),
		d.searchEntry,
		container.NewGridWithColumns(2,
			container.NewVBox(text("Sort by", 11, fyne.TextStyle{}, colMuted), d.sortSelect),
			container.NewVBox(text("Severity", 11, fyne.TextStyle{}, colMuted), d.riskSelect),
		),
	)

	listPane := container.NewBorder(container.NewPadded(controls), nil, nil, nil, d.findingsList)
	detailPane := container.NewVScroll(container.NewPadded(d.detailText))

	split := container.NewHSplit(listPane, detailPane)
	split.SetOffset(0.42)
	return container.NewPadded(split)
}

// renderDetail writes the selected finding's detail pane.
func (d *Desktop) renderDetail() {
	if d.detailText == nil {
		return
	}

	if d.selected < 0 || d.selected >= len(d.filtered) {
		if len(d.items) == 0 {
			d.detailText.ParseMarkdown("# Select a finding\n\nRun a scan to detect waste. Findings appear here with cost, risk, ownership and the recommended remediation.")
		} else {
			d.detailText.ParseMarkdown("# No matching findings\n\nNo findings match the current search and severity filters. Try widening them.")
		}
		return
	}

	item := d.filtered[d.selected]
	severity, _ := riskLevel(item.Risk)

	var b strings.Builder
	fmt.Fprintf(&b, "# %s\n\n", shortID(item.ID))
	// Rendered as plain text so long ARNs wrap instead of clipping.
	fmt.Fprintf(&b, "%s\n\n", item.ID)
	fmt.Fprintf(&b, "**Type** %s   ·   **Region** %s\n\n", friendlyType(item.Type), valueOr(item.Region, "global"))

	b.WriteString("## Financial impact\n\n")
	fmt.Fprintf(&b, "- Monthly waste: **%s**\n", money(item.Cost))
	fmt.Fprintf(&b, "- Annualised: **%s**\n\n", money(item.Cost*12))

	b.WriteString("## Risk assessment\n\n")
	fmt.Fprintf(&b, "- Severity: **%s**\n", severity)
	fmt.Fprintf(&b, "- Score: %d/100  `%s`\n", item.Risk, riskBar(item.Risk))
	fmt.Fprintf(&b, "- Reachability: %s\n\n", valueOr(item.Reachability, "Unknown"))

	b.WriteString("## Ownership & context\n\n")
	fmt.Fprintf(&b, "- Owner: %s\n", valueOr(item.Owner, "Unassigned"))
	fmt.Fprintf(&b, "- Reason: %s\n\n", valueOr(item.Reason, "Flagged by waste detection heuristics"))

	if len(item.Properties) > 0 {
		b.WriteString("## Properties\n\n")
		keys := make([]string, 0, len(item.Properties))
		for key := range item.Properties {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			fmt.Fprintf(&b, "- `%s`: %v\n", key, item.Properties[key])
		}
		b.WriteString("\n")
	}

	if item.Ignored {
		b.WriteString("> **Suppressed**: this finding is excluded from totals.\n")
	}

	d.detailText.ParseMarkdown(b.String())
}
