package main

import (
	"fmt"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/container"
	"fyne.io/fyne/v2/theme"
	"fyne.io/fyne/v2/widget"

	cloudapp "github.com/DrSkyle/cloudslash/v2/pkg/app"
)

// reportsScreen collects every artifact the engine can produce and lets the
// operator export or open them.
func (d *Desktop) reportsScreen() fyne.CanvasObject {
	exportButton := func(label string, pro bool, icon fyne.Resource, name string, method func(*cloudapp.Session, string) error) fyne.CanvasObject {
		btn := widget.NewButtonWithIcon(label, icon, func() {
			d.export(name, d.sessionWriter(method), pro)
		})
		if pro {
			btn.Importance = widget.MediumImportance
		}
		return btn
	}

	actions := container.NewGridWithColumns(3,
		exportButton("Waste report (JSON)", false, theme.DownloadIcon(), "waste_report.json", (*cloudapp.Session).ExportJSON),
		exportButton("Waste report (CSV)", false, theme.DownloadIcon(), "waste_report.csv", (*cloudapp.Session).ExportCSV),
		exportButton("Executive summary", false, theme.DocumentIcon(), "executive_summary.md", (*cloudapp.Session).ExportExecutiveSummary),
		exportButton("Remediation plan (Pro)", true, theme.WarningIcon(), "remediation_plan.json", (*cloudapp.Session).GenerateRemediationPlan),
		exportButton("Dashboard (Pro)", true, theme.GridIcon(), "dashboard.html", (*cloudapp.Session).ExportDashboard),
		exportButton("Analysis report (Pro)", true, theme.DocumentIcon(), "report.html", (*cloudapp.Session).ExportHTMLReport),
	)

	note := text("Opening an artifact here opens it with your default application.", 11, fyne.TextStyle{}, colFaint)

	top := container.NewVBox(
		sectionTitle("REPORTS & ARTIFACTS"),
		actions,
		container.NewGridWithColumns(2,
			widget.NewButtonWithIcon("Open output folder", theme.FolderOpenIcon(), d.openFolder),
			widget.NewButtonWithIcon("Refresh list", theme.ViewRefreshIcon(), d.refreshReports),
		),
		note,
	)

	card := surfaceBorder(
		container.NewPadded(sectionTitle("GENERATED ARTIFACTS")),
		container.NewPadded(d.reportSummary),
		d.reportList,
	)

	return container.NewBorder(container.NewPadded(top), nil, nil, nil, container.NewPadded(card))
}

// sessionWriter adapts a Session method to the path-based export signature,
// resolving the current session safely at call time.
func (d *Desktop) sessionWriter(method func(*cloudapp.Session, string) error) func(string) error {
	return func(path string) error {
		d.mu.Lock()
		session := d.session
		d.mu.Unlock()
		if session == nil {
			return fmt.Errorf("no scan has completed")
		}
		return method(session, path)
	}
}
