package main

import (
	"fmt"
	"sort"
	"strings"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/container"
	"fyne.io/fyne/v2/theme"
	"fyne.io/fyne/v2/widget"

	cloudapp "github.com/DrSkyle/cloudslash/v2/pkg/app"
)

// overviewScreen is the landing screen: scan configuration, KPIs and highlights.
func (d *Desktop) overviewScreen() fyne.CanvasObject {
	d.scanButtonAlt = widget.NewButtonWithIcon("Run scan", theme.MediaPlayIcon(), d.startScan)
	d.scanButtonAlt.Importance = widget.HighImportance

	config := surface(
		sectionTitle("SCAN CONFIGURATION"),
		container.NewGridWithColumns(2,
			container.NewBorder(nil, nil, text("AWS region", 12, fyne.TextStyle{}, colMuted), nil, d.regionEntry),
			container.NewBorder(nil, nil, text("Data source", 12, fyne.TextStyle{}, colMuted), nil, d.demoCheck),
		),
		container.NewGridWithColumns(3,
			d.scanButtonAlt,
			widget.NewButtonWithIcon("Open output folder", theme.FolderOpenIcon(), d.openFolder),
			widget.NewButtonWithIcon("Reload reports", theme.ViewRefreshIcon(), d.refreshReports),
		),
		d.progressBar,
		d.statusLabel,
	)

	body := container.NewVBox(
		config,
		d.kpiGrid,
		container.NewGridWithColumns(2,
			surface(sectionTitle("SCAN SUMMARY"), d.summary),
			surface(sectionTitle("TOP OPPORTUNITIES"), d.topFinds),
		),
		surface(sectionTitle("WASTE BY SERVICE"), d.serviceBreakdown),
	)

	return container.NewVScroll(container.NewPadded(body))
}

// refreshOverview re-renders the KPI tiles and summary panels from the latest snapshot.
func (d *Desktop) refreshOverview() {
	s := d.lastSnapshot

	if d.kpiGrid != nil {
		d.kpiGrid.Objects = []fyne.CanvasObject{
			statTile("MONTHLY WASTE", money(s.MonthlyWaste), colDanger),
			statTile("ANNUALISED", money(s.MonthlyWaste*12), colWarn),
			statTile("RESOURCES SCANNED", fmt.Sprintf("%d", s.TotalNodes), colText),
			statTile("WASTE FINDINGS", fmt.Sprintf("%d", s.WasteCount), colAccent),
		}
		d.kpiGrid.Refresh()
	}

	if d.summary != nil {
		var b strings.Builder
		if s.TotalNodes == 0 && s.Status == "" {
			b.WriteString("### No scan loaded\n\n")
			b.WriteString("Run a scan to build the infrastructure dependency graph and detect waste.\n\n")
			b.WriteString("Demo mode uses realistic synthetic data, so you can explore the full workflow without an AWS account.")
		} else {
			fmt.Fprintf(&b, "**Region:** `%s`\n\n", valueOr(d.regionEntry.Text, "us-east-1"))
			fmt.Fprintf(&b, "**Status:** %s\n\n", statusLabelFor(s))
			fmt.Fprintf(&b, "- Resources analysed: **%d**\n", s.TotalNodes)
			fmt.Fprintf(&b, "- Waste findings: **%d**\n", s.WasteCount)
			fmt.Fprintf(&b, "- Suppressed (ignored): **%d**\n", s.IgnoredCount)
			fmt.Fprintf(&b, "- Mapping edges: **%d**\n", len(s.Edges))
			if s.Partial {
				b.WriteString("\n**Partial scan**: some scopes could not be read. Results may be incomplete.")
			}
			if s.Error != "" {
				fmt.Fprintf(&b, "\n**Error:** %s", s.Error)
			}
		}
		d.summary.ParseMarkdown(b.String())
	}

	if d.topFinds != nil {
		d.topFinds.ParseMarkdown(topOpportunitiesMarkdown(d.items))
	}

	d.refreshServiceBreakdown(d.items)
}

func statusLabelFor(s cloudapp.Snapshot) string {
	switch s.Status {
	case "scanning":
		return "Scanning…"
	case "complete":
		return "Complete"
	case "failed":
		return "Failed"
	default:
		return "Ready"
	}
}

func topOpportunitiesMarkdown(items []cloudapp.Finding) string {
	if len(items) == 0 {
		return "_No findings yet._\n\nRun a scan to populate the opportunity list."
	}
	var b strings.Builder
	limit := len(items)
	if limit > 6 {
		limit = 6
	}
	for _, item := range items[:limit] {
		fmt.Fprintf(&b, "**%s** · %s\n\n", money(item.Cost), friendlyType(item.Type))
		fmt.Fprintf(&b, "`%s` - %s\n\n", shortID(item.ID), truncate(valueOr(item.Reason, "Flagged by heuristics"), 140))
	}
	if len(items) > limit {
		fmt.Fprintf(&b, "_…and %d more findings._", len(items)-limit)
	}
	return b.String()
}

// refreshServiceBreakdown renders a proportional bar per resource type.
func (d *Desktop) refreshServiceBreakdown(items []cloudapp.Finding) {
	if d.serviceBreakdown == nil {
		return
	}

	type aggregate struct {
		name  string
		cost  float64
		count int
	}
	byType := map[string]*aggregate{}
	for _, item := range items {
		name := friendlyType(item.Type)
		a, ok := byType[name]
		if !ok {
			a = &aggregate{name: name}
			byType[name] = a
		}
		a.cost += item.Cost
		a.count++
	}

	if len(byType) == 0 {
		d.serviceBreakdown.Objects = []fyne.CanvasObject{
			text("No findings to chart yet. Run a scan to see where waste concentrates.", 12, fyne.TextStyle{}, colMuted),
		}
		d.serviceBreakdown.Refresh()
		return
	}

	ranked := make([]*aggregate, 0, len(byType))
	var maxCost float64
	for _, a := range byType {
		ranked = append(ranked, a)
		if a.cost > maxCost {
			maxCost = a.cost
		}
	}
	sort.Slice(ranked, func(i, j int) bool { return ranked[i].cost > ranked[j].cost })
	if len(ranked) > 8 {
		ranked = ranked[:8]
	}

	rows := make([]fyne.CanvasObject, 0, len(ranked))
	for _, a := range ranked {
		name := text(truncate(a.name, 20), 12, fyne.TextStyle{Bold: true}, colText)
		gauge := text(bar(a.cost, maxCost, 18), 12, fyne.TextStyle{}, colAccent)
		value := text(fmt.Sprintf("%s  ·  %s", money(a.cost), plural(a.count, "finding", "findings")), 12, fyne.TextStyle{}, colMuted)
		rows = append(rows, container.NewBorder(nil, nil, name, value, container.NewCenter(gauge)))
	}

	d.serviceBreakdown.Objects = rows
	d.serviceBreakdown.Refresh()
}
