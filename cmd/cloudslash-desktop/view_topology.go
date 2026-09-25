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

// topologyScreen visualises how waste is distributed across the graph.
func (d *Desktop) topologyScreen() fyne.CanvasObject {
	header := container.NewBorder(nil, nil,
		sectionTitle("DEPENDENCY TOPOLOGY"),
		container.NewHBox(widget.NewButtonWithIcon("Refresh", theme.ViewRefreshIcon(), d.renderTopology)),
	)

	return container.NewBorder(
		container.NewPadded(header),
		nil, nil, nil,
		container.NewVScroll(container.NewPadded(d.topologyText)),
	)
}

// renderTopology renders the distribution of waste across services and resources.
func (d *Desktop) renderTopology() {
	if d.topologyText == nil {
		return
	}

	s := d.lastSnapshot
	if len(s.Findings) == 0 {
		if s.Status == "scanning" {
			d.topologyText.ParseMarkdown("# Building topology…\n\nThe dependency graph is being assembled. This view refreshes automatically.")
		} else {
			d.topologyText.ParseMarkdown("# No topology yet\n\nRun a scan to map resource dependencies and see where waste concentrates.")
		}
		return
	}

	type group struct {
		name     string
		cost     float64
		count    int
		findings []cloudapp.Finding
	}

	groups := map[string]*group{}
	for _, item := range s.Findings {
		key := friendlyType(item.Type)
		g, ok := groups[key]
		if !ok {
			g = &group{name: key}
			groups[key] = g
		}
		g.cost += item.Cost
		g.count++
		g.findings = append(g.findings, item)
	}

	ordered := make([]*group, 0, len(groups))
	var maxCost float64
	for _, g := range groups {
		ordered = append(ordered, g)
		if g.cost > maxCost {
			maxCost = g.cost
		}
	}
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].cost > ordered[j].cost })

	var b strings.Builder
	b.WriteString("# Dependency topology\n\n")
	fmt.Fprintf(&b, "**%d** findings across **%d** services · **%d** dependency edges mapped · **%s**/month\n\n",
		len(s.Findings), len(ordered), len(s.Edges), money(s.MonthlyWaste))

	b.WriteString("## Monthly waste by service\n\n")
	b.WriteString("```\n")
	for _, g := range ordered {
		line := fmt.Sprintf("%-22s %s %10s  (%d)", truncate(g.name, 22), bar(g.cost, maxCost, 22), money(g.cost), g.count)
		b.WriteString(line + "\n")
	}
	b.WriteString("```\n\n")

	for _, g := range ordered {
		fmt.Fprintf(&b, "### %s: %s/month\n\n", g.name, money(g.cost))
		sort.Slice(g.findings, func(i, j int) bool { return g.findings[i].Cost > g.findings[j].Cost })
		for _, item := range g.findings {
			risk, _ := riskLevel(item.Risk)
			fmt.Fprintf(&b, "- `%s`: %s  ·  %s risk\n", truncate(item.ID, 78), money(item.Cost), risk)
		}
		b.WriteString("\n")
	}

	d.topologyText.ParseMarkdown(b.String())
}

// bar renders a proportional unicode bar within a fixed width.
func bar(value, max float64, width int) string {
	if max <= 0 || width <= 0 {
		return ""
	}
	filled := int((value / max) * float64(width))
	if filled < 1 && value > 0 {
		filled = 1
	}
	if filled > width {
		filled = width
	}
	return strings.Repeat("█", filled) + strings.Repeat("░", width-filled)
}
