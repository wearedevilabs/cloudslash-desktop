package main

import (
	"context"
	"fmt"
	"image/color"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/canvas"
	"fyne.io/fyne/v2/container"
	"fyne.io/fyne/v2/dialog"
	"fyne.io/fyne/v2/theme"
	"fyne.io/fyne/v2/widget"

	cloudapp "github.com/DrSkyle/cloudslash/v2/pkg/app"
	"github.com/DrSkyle/cloudslash/v2/pkg/billing"
	"github.com/DrSkyle/cloudslash/v2/pkg/engine"
)

// artifact is a file produced by the engine for the Reports screen.
type artifact struct {
	Name    string
	Size    int64
	ModTime time.Time
}

// navItem describes a top-level screen.
type navItem struct {
	title   string
	icon    fyne.Resource
	content fyne.CanvasObject
}

// Desktop holds all application state and widgets.
type Desktop struct {
	app fyne.App
	win fyne.Window

	mu           sync.Mutex
	session      *cloudapp.Session
	items        []cloudapp.Finding
	filtered     []cloudapp.Finding
	selected     int
	scanning     bool
	lastSnapshot cloudapp.Snapshot

	outputDir string

	billing *billing.Service

	// Scan widgets.
	regionEntry   *widget.Entry
	demoCheck     *widget.Check
	scanButton    *widget.Button
	scanButtonAlt *widget.Button
	progressBar   *widget.ProgressBar
	statusLabel   *widget.Label

	// Overview.
	kpiGrid          *fyne.Container
	summary          *widget.RichText
	topFinds         *widget.RichText
	serviceBreakdown *fyne.Container

	// Findings.
	searchEntry  *widget.Entry
	sortSelect   *widget.Select
	riskSelect   *widget.Select
	findingsList *widget.List
	detailText   *widget.RichText

	// Topology.
	topologyText *widget.RichText

	// Reports.
	reportList    *widget.List
	artifacts     []artifact
	reportSummary *fyne.Container

	// Billing / Pro.
	apiKeyEntry      *widget.Entry
	appUserEntry     *widget.Entry
	entitlementEntry *widget.Entry
	proStatus        *widget.RichText
	proPlanBadge     *fyne.Container
	purchaseURL      *widget.Entry

	// Navigation.
	headerBadge *fyne.Container
	headerStat  *fyne.Container
	content     *fyne.Container
	navButtons  []*widget.Button
	screens     []navItem
	active      int

	failedAt string
}

// newDesktop constructs the application state and widgets.
func newDesktop(application fyne.App, window fyne.Window) *Desktop {
	d := &Desktop{
		app:         application,
		win:         window,
		outputDir:   "cloudslash-out",
		selected:    -1,
		active:      0,
		billing:     billing.NewService(billing.ConfigFromEnv(), &billing.Store{Path: billing.DefaultStorePath()}),
		regionEntry: widget.NewEntry(),
		demoCheck:   widget.NewCheck("Demo mode (synthetic data, no credentials)", nil),
		searchEntry: widget.NewEntry(),
	}

	d.regionEntry.SetText("us-east-1")
	d.regionEntry.SetPlaceHolder("us-east-1")
	d.searchEntry.SetPlaceHolder("Filter by resource ID, type or region…")

	d.progressBar = widget.NewProgressBar()
	d.progressBar.Min, d.progressBar.Max, d.progressBar.Value = 0, 1, 0

	d.statusLabel = widget.NewLabel("Ready. Run a scan to analyse your infrastructure.")
	d.statusLabel.Wrapping = fyne.TextWrapWord
	d.statusLabel.Importance = widget.LowImportance

	cfg := d.billing.Config()
	d.demoCheck.SetChecked(true)

	d.apiKeyEntry = widget.NewPasswordEntry()
	d.apiKeyEntry.SetPlaceHolder("RevenueCat secret API key (sk_…)")
	d.apiKeyEntry.SetText(cfg.APIKey)
	d.appUserEntry = widget.NewEntry()
	d.appUserEntry.SetPlaceHolder("App User ID (shared with your mobile app)")
	d.appUserEntry.SetText(cfg.AppUserID)
	d.entitlementEntry = widget.NewEntry()
	d.entitlementEntry.SetPlaceHolder("Entitlement identifier")
	d.entitlementEntry.SetText(cfg.EntitlementID)
	d.purchaseURL = widget.NewEntry()
	d.purchaseURL.SetPlaceHolder("Upgrade URL (optional)")

	d.buildWidgets()
	return d
}

// buildWidgets creates the widgets that need a live reference before layout.
func (d *Desktop) buildWidgets() {
	d.kpiGrid = container.NewGridWithColumns(4)
	d.summary = newMarkdown("")
	d.topFinds = newMarkdown("")
	d.serviceBreakdown = container.NewVBox()

	d.sortSelect = widget.NewSelect([]string{sortCostDesc, sortRiskDesc, sortNameAsc}, func(string) {
		d.applyFilter()
	})
	d.sortSelect.Selected = sortCostDesc

	d.riskSelect = widget.NewSelect([]string{riskAll, riskCritical, riskHigh, riskMedium}, func(string) {
		d.applyFilter()
	})
	d.riskSelect.Selected = riskAll

	d.searchEntry.OnChanged = func(string) { d.applyFilter() }

	d.detailText = newMarkdown("")

	d.findingsList = widget.NewList(
		func() int { return len(d.filtered) },
		func() fyne.CanvasObject {
			title := text("", 14, fyne.TextStyle{Bold: true}, colText)
			meta := text("", 11, fyne.TextStyle{}, colMuted)
			badgeText := text("", 11, fyne.TextStyle{Bold: true}, colMuted)
			top := container.NewBorder(nil, nil, nil, badgeText, title)
			return container.NewVBox(top, meta)
		},
		func(id widget.ListItemID, obj fyne.CanvasObject) {
			if id < 0 || id >= len(d.filtered) {
				return
			}
			item := d.filtered[id]
			box := obj.(*fyne.Container)
			top := box.Objects[0].(*fyne.Container)
			title := top.Objects[0].(*canvas.Text)
			badgeText := top.Objects[1].(*canvas.Text)
			meta := box.Objects[1].(*canvas.Text)

			title.Text = fmt.Sprintf("%s  ·  %s", money(item.Cost), friendlyType(item.Type))
			title.Refresh()
			label, col := riskLevel(item.Risk)
			badgeText.Text = label
			badgeText.Color = col
			badgeText.Refresh()

			meta.Text = truncate(fmt.Sprintf("%s  ·  %s", shortID(item.ID), valueOr(item.Region, "global")), 90)
			meta.Refresh()
		},
	)
	d.findingsList.OnSelected = func(id widget.ListItemID) {
		d.selected = id
		d.renderDetail()
	}

	d.topologyText = newMarkdown("")

	d.reportList = widget.NewList(
		func() int { return len(d.artifacts) },
		func() fyne.CanvasObject {
			name := text("", 13, fyne.TextStyle{Bold: true}, colText)
			meta := text("", 11, fyne.TextStyle{}, colMuted)
			return container.NewVBox(name, meta)
		},
		func(id widget.ListItemID, obj fyne.CanvasObject) {
			if id < 0 || id >= len(d.artifacts) {
				return
			}
			a := d.artifacts[id]
			box := obj.(*fyne.Container)
			name := box.Objects[0].(*canvas.Text)
			meta := box.Objects[1].(*canvas.Text)
			name.Text = a.Name
			name.Refresh()
			meta.Text = fmt.Sprintf("%s  ·  updated %s", humanBytes(a.Size), relTime(a.ModTime))
			meta.Refresh()
		},
	)
	d.reportList.OnSelected = func(id widget.ListItemID) {
		if id >= 0 && id < len(d.artifacts) {
			d.openArtifact(d.artifacts[id].Name)
		}
	}

	d.reportSummary = container.NewVBox()

	d.proStatus = newMarkdown("")
	d.proPlanBadge = container.NewStack()
	d.headerBadge = container.NewStack()
	d.headerStat = container.NewStack()
}

func valueOr(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

// ---------------------------------------------------------------- layout

func (d *Desktop) build() {
	d.screens = []navItem{
		{title: "Overview", icon: theme.HomeIcon(), content: d.overviewScreen()},
		{title: "Findings", icon: theme.ListIcon(), content: d.findingsScreen()},
		{title: "Topology", icon: theme.GridIcon(), content: d.topologyScreen()},
		{title: "Reports", icon: theme.DocumentIcon(), content: d.reportsScreen()},
		{title: "Pro", icon: theme.AccountIcon(), content: d.proScreen()},
	}

	d.content = container.NewStack()
	d.win.SetContent(container.NewBorder(d.header(), nil, d.sidebar(), nil, d.content))

	d.navigate(0)
	d.refreshBilling()
	d.refreshReports()
	d.refreshOverview()
	d.renderDetail()
	d.renderTopology()

	go d.poll()

	// Kick off a demo scan so the app never opens on an empty screen.
	go func() {
		time.Sleep(400 * time.Millisecond)
		fyne.Do(func() {
			if d.demoCheck.Checked {
				d.startScan()
			}
		})
	}()
}

func (d *Desktop) header() fyne.CanvasObject {
	title := text("CloudSlash", 22, fyne.TextStyle{Bold: true}, colText)
	subtitle := text("Autonomous cloud waste detection & remediation", 12, fyne.TextStyle{}, colMuted)
	left := container.NewVBox(title, subtitle)

	d.scanButton = widget.NewButtonWithIcon("Run scan", theme.MediaPlayIcon(), d.startScan)
	d.scanButton.Importance = widget.HighImportance

	right := container.NewHBox(d.headerStat, d.headerBadge, d.scanButton)
	bar := container.NewBorder(nil, nil, container.NewPadded(left), container.NewPadded(right))

	bg := canvas.NewRectangle(colSurface)
	bg.StrokeColor = colBorder
	bg.StrokeWidth = 1
	return container.NewStack(bg, bar)
}

func (d *Desktop) sidebar() fyne.CanvasObject {
	d.navButtons = nil
	box := container.NewVBox()
	for i, item := range d.screens {
		index := i
		btn := widget.NewButtonWithIcon(item.title, item.icon, func() { d.navigate(index) })
		btn.Alignment = widget.ButtonAlignLeading
		d.navButtons = append(d.navButtons, btn)
		box.Add(btn)
	}

	footer := container.NewVBox(
		canvas.NewLine(colBorder),
		text("Local-first analysis", 11, fyne.TextStyle{Bold: true}, colMuted),
		text("No data leaves your machine.", 11, fyne.TextStyle{}, colFaint),
	)

	spacer := container.NewStack(canvas.NewRectangle(colBg))
	side := container.NewBorder(nil, container.NewPadded(footer), nil, nil,
		container.NewVBox(container.NewPadded(box), spacer))

	return container.NewStack(canvas.NewRectangle(colBg), side)
}

func (d *Desktop) navigate(index int) {
	if index < 0 || index >= len(d.screens) {
		return
	}
	d.active = index
	for i, btn := range d.navButtons {
		if i == index {
			btn.Importance = widget.HighImportance
		} else {
			btn.Importance = widget.MediumImportance
		}
		btn.Refresh()
	}
	d.content.Objects = []fyne.CanvasObject{d.screens[index].content}
	d.content.Refresh()

	switch d.screens[index].title {
	case "Findings":
		d.renderDetail()
	case "Topology":
		d.renderTopology()
	case "Reports":
		d.refreshReports()
	case "Pro":
		d.refreshBilling()
	}
}

// ---------------------------------------------------------------- scanning

func (d *Desktop) isScanning() bool {
	d.mu.Lock()
	defer d.mu.Unlock()
	return d.scanning
}

func (d *Desktop) startScan() {
	if d.isScanning() {
		dialog.ShowInformation("Scan in progress", "A scan is already running. Please wait for it to finish.", d.win)
		return
	}

	region := strings.TrimSpace(d.regionEntry.Text)
	if region == "" {
		region = "us-east-1"
		d.regionEntry.SetText(region)
	}

	cfg := engine.Config{
		Region:        region,
		MockMode:      d.demoCheck.Checked,
		OutputDir:     d.outputDir,
		Headless:      true,
		SkipTelemetry: true,
		Logger:        slog.New(slog.NewTextHandler(io.Discard, nil)),
	}

	d.mu.Lock()
	d.scanning = true
	d.failedAt = ""
	d.mu.Unlock()

	d.setScanButtonState(false, "Scanning…")
	d.progressBar.SetValue(0.03)
	if cfg.MockMode {
		d.statusLabel.SetText("Scanning demo infrastructure: building dependency graph and running heuristics…")
	} else {
		d.statusLabel.SetText(fmt.Sprintf("Scanning AWS region %s…", region))
	}
	d.updateHeaderStatus("Scanning", colInfo)

	go func() {
		session, err := cloudapp.NewSession(context.Background(), cfg)
		if err != nil {
			fyne.Do(func() { d.failScan(err) })
			return
		}
		d.mu.Lock()
		d.session = session
		d.mu.Unlock()
		session.Start()
	}()
}

func (d *Desktop) failScan(err error) {
	d.mu.Lock()
	d.scanning = false
	d.mu.Unlock()

	d.setScanButtonState(true, "Run scan")
	d.progressBar.SetValue(0)
	d.statusLabel.SetText("Scan failed: " + err.Error())
	d.updateHeaderStatus("Failed", colDanger)
	dialog.ShowError(fmt.Errorf("scan failed to start: %w", err), d.win)
}

func (d *Desktop) poll() {
	ticker := time.NewTicker(400 * time.Millisecond)
	defer ticker.Stop()
	for range ticker.C {
		d.mu.Lock()
		session := d.session
		d.mu.Unlock()
		if session == nil {
			continue
		}
		snapshot := session.Snapshot()
		fyne.Do(func() { d.applySnapshot(snapshot) })
	}
}

func (d *Desktop) applySnapshot(snapshot cloudapp.Snapshot) {
	d.lastSnapshot = snapshot
	d.items = snapshot.Findings
	d.applyFilter()
	d.refreshOverview()
	d.renderTopology()

	switch snapshot.Status {
	case cloudapp.StatusScanning:
		d.updateHeaderStatus("Scanning", colInfo)
		if v := d.progressBar.Value; v < 0.9 {
			d.progressBar.SetValue(v + 0.04)
		}
	case cloudapp.StatusComplete:
		d.mu.Lock()
		wasScanning := d.scanning
		d.scanning = false
		d.mu.Unlock()
		d.progressBar.SetValue(1)
		d.setScanButtonState(true, "Run scan")
		d.updateHeaderStatus("Complete", colAccent)
		if snapshot.Partial {
			d.statusLabel.SetText(fmt.Sprintf("Scan complete with partial results: %d resources, %d findings, %s/month. Some scopes failed.",
				snapshot.TotalNodes, snapshot.WasteCount, money(snapshot.MonthlyWaste)))
		} else {
			d.statusLabel.SetText(fmt.Sprintf("Scan complete: %d resources analysed, %d findings worth %s/month.",
				snapshot.TotalNodes, snapshot.WasteCount, money(snapshot.MonthlyWaste)))
		}
		if wasScanning {
			d.refreshReports()
		}
	case cloudapp.StatusFailed:
		d.mu.Lock()
		d.scanning = false
		alreadyShown := d.failedAt == snapshot.Error
		d.failedAt = snapshot.Error
		d.mu.Unlock()
		d.progressBar.SetValue(0)
		d.setScanButtonState(true, "Run scan")
		d.updateHeaderStatus("Failed", colDanger)
		d.statusLabel.SetText("Scan failed: " + snapshot.Error)
		if !alreadyShown {
			dialog.ShowError(fmt.Errorf("scan failed: %s", snapshot.Error), d.win)
		}
	}
}

// ---------------------------------------------------------------- filtering

const (
	sortCostDesc = "Cost (high to low)"
	sortRiskDesc = "Risk (high to low)"
	sortNameAsc  = "Name (A to Z)"

	riskAll      = "All severities"
	riskCritical = "Critical only"
	riskHigh     = "High and above"
	riskMedium   = "Medium and above"
)

func (d *Desktop) applyFilter() {
	query := strings.ToLower(strings.TrimSpace(d.searchEntry.Text))
	riskFloor := 0
	switch d.riskSelect.Selected {
	case riskCritical:
		riskFloor = 80
	case riskHigh:
		riskFloor = 60
	case riskMedium:
		riskFloor = 30
	}

	filtered := make([]cloudapp.Finding, 0, len(d.items))
	for _, item := range d.items {
		if riskFloor > 0 && item.Risk < riskFloor {
			continue
		}
		if query != "" &&
			!strings.Contains(strings.ToLower(item.ID), query) &&
			!strings.Contains(strings.ToLower(item.Type), query) &&
			!strings.Contains(strings.ToLower(friendlyType(item.Type)), query) &&
			!strings.Contains(strings.ToLower(item.Region), query) {
			continue
		}
		filtered = append(filtered, item)
	}

	switch d.sortSelect.Selected {
	case sortRiskDesc:
		sort.SliceStable(filtered, func(i, j int) bool { return filtered[i].Risk > filtered[j].Risk })
	case sortNameAsc:
		sort.SliceStable(filtered, func(i, j int) bool { return filtered[i].ID < filtered[j].ID })
	default:
		sort.SliceStable(filtered, func(i, j int) bool { return filtered[i].Cost > filtered[j].Cost })
	}

	d.filtered = filtered
	if d.findingsList != nil {
		d.findingsList.Refresh()
	}

	if len(filtered) == 0 {
		d.selected = -1
		if d.findingsList != nil {
			d.findingsList.UnselectAll()
		}
	} else {
		if d.selected < 0 || d.selected >= len(filtered) {
			d.selected = 0
		}
		if d.findingsList != nil {
			d.findingsList.Select(d.selected)
		}
	}
	d.renderDetail()
}

// ---------------------------------------------------------------- reports

func (d *Desktop) refreshReports() {
	entries, err := os.ReadDir(d.outputDir)
	if err != nil {
		d.artifacts = nil
	} else {
		var list []artifact
		for _, entry := range entries {
			if entry.IsDir() {
				continue
			}
			info, err := entry.Info()
			if err != nil {
				continue
			}
			list = append(list, artifact{Name: entry.Name(), Size: info.Size(), ModTime: info.ModTime()})
		}
		sort.Slice(list, func(i, j int) bool { return list[i].Name < list[j].Name })
		d.artifacts = list
	}

	if d.reportList != nil {
		d.reportList.Refresh()
	}
	d.refreshReportSummary()
}

func (d *Desktop) refreshReportSummary() {
	if d.reportSummary == nil {
		return
	}
	if len(d.artifacts) == 0 {
		d.reportSummary.Objects = []fyne.CanvasObject{emptyState(
			"No reports yet",
			"Run a scan to generate waste reports, remediation plans and an executive dashboard.",
		)}
	} else {
		d.reportSummary.Objects = []fyne.CanvasObject{
			text(fmt.Sprintf("%d artifacts in %s", len(d.artifacts), d.outputDir), 12, fyne.TextStyle{}, colMuted),
		}
	}
	d.reportSummary.Refresh()
}

func (d *Desktop) export(name string, writer func(string) error, pro bool) {
	if pro && !d.isPro() {
		d.showPaywall("Exporting forensic reports and remediation plans")
		return
	}
	d.mu.Lock()
	hasSession := d.session != nil
	d.mu.Unlock()
	if !hasSession {
		dialog.ShowInformation("Run a scan first", "There is no completed scan to export yet.", d.win)
		return
	}

	path := filepath.Join(d.outputDir, name)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		dialog.ShowError(fmt.Errorf("could not create %s: %w", d.outputDir, err), d.win)
		return
	}
	if err := writer(path); err != nil {
		dialog.ShowError(fmt.Errorf("export failed: %w", err), d.win)
		return
	}
	d.refreshReports()
	dialog.ShowInformation("Export complete", fmt.Sprintf("Wrote %s\n\nOpen it from the Reports tab.", path), d.win)
}

func (d *Desktop) openArtifact(name string) {
	path := filepath.Join(d.outputDir, name)
	if _, err := os.Stat(path); err != nil {
		dialog.ShowInformation("Not available", fmt.Sprintf("%s has not been generated yet. Run a scan first.", name), d.win)
		return
	}
	if strings.HasSuffix(name, ".html") && !d.isPro() {
		d.showPaywall("Opening the interactive HTML dashboard")
		return
	}
	if err := openInBrowser(path); err != nil {
		dialog.ShowInformation("Cannot open", fmt.Sprintf("Could not open %s automatically.\n\nPath: %s", name, absPath(path)), d.win)
	}
}

func (d *Desktop) openFolder() {
	if err := openPath(absPath(d.outputDir)); err != nil {
		dialog.ShowInformation("Output folder", absPath(d.outputDir), d.win)
	}
}

// ---------------------------------------------------------------- misc

func absPath(path string) string {
	abs, err := filepath.Abs(path)
	if err != nil {
		return path
	}
	return abs
}

func openInBrowser(path string) error {
	return openPath(absPath(path))
}

func openPath(target string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", target)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", target)
	default:
		cmd = exec.Command("xdg-open", target)
	}
	return cmd.Start()
}

// setScanButtonState keeps both scan entry points (header and overview) in sync.
func (d *Desktop) setScanButtonState(enabled bool, label string) {
	for _, btn := range []*widget.Button{d.scanButton, d.scanButtonAlt} {
		if btn == nil {
			continue
		}
		if enabled {
			btn.Enable()
		} else {
			btn.Disable()
		}
		btn.SetText(label)
	}
}

func (d *Desktop) updateHeaderStatus(label string, col color.Color) {
	if d.headerStat == nil {
		return
	}
	d.headerStat.Objects = []fyne.CanvasObject{badge(label, colSurfaceAlt, col)}
	d.headerStat.Refresh()
}
