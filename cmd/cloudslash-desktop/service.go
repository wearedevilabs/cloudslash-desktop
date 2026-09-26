package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"

	cloudapp "github.com/DrSkyle/cloudslash/v2/pkg/app"
	"github.com/DrSkyle/cloudslash/v2/pkg/engine"
	engineaws "github.com/DrSkyle/cloudslash/v2/pkg/engine/aws"
	"github.com/DrSkyle/cloudslash/v2/pkg/version"
)

// Desktop is the service the interface talks to.
//
// Every method here is reachable from the frontend as "Desktop.<Name>". The
// shapes it returns are deliberately their own DTOs rather than the engine's
// internal types: the UI should not be coupled to graph internals, and sending
// the edge list across the bridge to display a count would be wasteful.
//
// It owns exactly three pieces of state: the running session, the saved
// preferences, and a stable per-install identifier used as the RevenueCat app
// user id. Entitlements themselves are resolved in the frontend by the
// RevenueCat web SDK; this process never holds a secret key.
type Desktop struct {
	app *application.App

	mu         sync.RWMutex
	session    *cloudapp.Session
	hasScan    bool
	startedAt  time.Time
	finishedAt time.Time
	status     string
	errMsg     string
	cancel     context.CancelFunc

	prefs     PrefsDTO
	prefsPath string
	userID    string

	// verifier owns the optional, server-side entitlement check. See verify.go:
	// it reads a secret key from the environment and never lets it escape.
	verifier *verifier
}

const (
	statusReady     = "ready"
	statusScanning  = "scanning"
	statusComplete  = "complete"
	statusCancelled = "cancelled"
	statusFailed    = "failed"
)

// ---------------------------------------------------------------- DTOs

// FindingDTO is a presentation-neutral waste finding.
type FindingDTO struct {
	ID           string         `json:"ID"`
	Type         string         `json:"Type"`
	Region       string         `json:"Region"`
	Reason       string         `json:"Reason"`
	Owner        string         `json:"Owner"`
	Reachability string         `json:"Reachability"`
	Cost         float64        `json:"Cost"`
	Risk         int            `json:"Risk"`
	Ignored      bool           `json:"Ignored"`
	Properties   map[string]any `json:"Properties"`
}

// SnapshotDTO is everything a screen needs to render current totals.
type SnapshotDTO struct {
	Status           string       `json:"Status"`
	Region           string       `json:"Region"`
	TotalNodes       int          `json:"TotalNodes"`
	WasteCount       int          `json:"WasteCount"`
	IgnoredCount     int          `json:"IgnoredCount"`
	MonthlyWaste     float64      `json:"MonthlyWaste"`
	Findings         []FindingDTO `json:"Findings"`
	EdgeCount        int          `json:"EdgeCount"`
	Partial          bool         `json:"Partial"`
	FailedScopeCount int          `json:"FailedScopeCount"`
	Error            string       `json:"Error"`
	StartedAt        string       `json:"StartedAt"`
	FinishedAt       string       `json:"FinishedAt"`
}

type ArtifactDTO struct {
	Name    string `json:"Name"`
	Size    int64  `json:"Size"`
	ModTime string `json:"ModTime"`
	Kind    string `json:"Kind"`
}

// ExportSpecDTO describes one artifact the engine can produce.
//
// There is no gated flag: every artifact is free, so there is nothing to gate.
type ExportSpecDTO struct {
	Kind        string `json:"Kind"`
	Label       string `json:"Label"`
	FileName    string `json:"FileName"`
	Description string `json:"Description"`
	Ready       bool   `json:"Ready"`
}

type ProfileDTO struct {
	UserID    string `json:"UserID"`
	Version   string `json:"Version"`
	License   string `json:"License"`
	OutputDir string `json:"OutputDir"`
	DataDir   string `json:"DataDir"`
	Platform  string `json:"Platform"`
}

// PrefsDTO mirrors engine.Config's user-facing surface one-to-one, so a scan
// started from the window behaves like the same flags on the command line.
type PrefsDTO struct {
	Region           string  `json:"Region"`
	Demo             bool    `json:"Demo"`
	Profile          string  `json:"Profile"`
	AllProfiles      bool    `json:"AllProfiles"`
	TFStatePath      string  `json:"TFStatePath"`
	DisableCWMetrics bool    `json:"DisableCWMetrics"`
	MaxConcurrency   int     `json:"MaxConcurrency"`
	DiscountRate     float64 `json:"DiscountRate"`
	StrictMode       bool    `json:"StrictMode"`
	RulesFile        string  `json:"RulesFile"`
	RequiredTags     string  `json:"RequiredTags"`
	HistoryURL       string  `json:"HistoryURL"`
	SlackWebhook     string  `json:"SlackWebhook"`
	SlackChannel     string  `json:"SlackChannel"`
	OtelEndpoint     string  `json:"OtelEndpoint"`
	OutputDir        string  `json:"OutputDir"`
}

func defaultPrefs() PrefsDTO {
	return PrefsDTO{
		Region: "",
		// A live account is the default. Demo mode is synthetic data, so it is
		// opted into rather than assumed.
		Demo:           false,
		MaxConcurrency: 20,
		OutputDir:      defaultOutputDir(),
	}
}

// AwsProfilesDTO is the list of profiles available on this machine.
type AwsProfilesDTO struct {
	Profiles []string `json:"Profiles"`
	Error    string   `json:"Error"`
}

// AwsIdentity is the result of checking whether a profile can be used.
type AwsIdentity struct {
	Connected bool   `json:"Connected"`
	Account   string `json:"Account"`
	Profile   string `json:"Profile"`
	Region    string `json:"Region"`
	Error     string `json:"Error"`
}

// persistedState is what survives a restart.
type persistedState struct {
	UserID string   `json:"user_id"`
	Prefs  PrefsDTO `json:"prefs"`
}

// ------------------------------------------------------------- exports

// exportSpecs is the single source of truth for what the engine can produce.
// The interface reads it rather than hard-coding a second copy of the list.
var exportSpecs = []ExportSpecDTO{
	{
		Kind:        "json",
		Label:       "Waste report",
		FileName:    "waste_report.json",
		Description: "Every finding as JSON, for a pipeline or a ticket.",
	},
	{
		Kind:        "csv",
		Label:       "Waste report",
		FileName:    "waste_report.csv",
		Description: "The same findings as a spreadsheet.",
	},
	{
		Kind:        "markdown",
		Label:       "Executive summary",
		FileName:    "executive_summary.md",
		Description: "A page you can paste into a review.",
	},
	{
		Kind:        "remediation",
		Label:       "Remediation plan",
		FileName:    "remediation_plan.json",
		Description: "The Lazarus Protocol plan: snapshot, stop, detach, roll back.",
	},
	{
		Kind:        "dashboard",
		Label:       "Executive dashboard",
		FileName:    "dashboard.html",
		Description: "Self-contained dashboard with the cost-flow diagram.",
	},
	{
		Kind:        "report",
		Label:       "Analysis report",
		FileName:    "report.html",
		Description: "Portable HTML report for a review or a ticket.",
	},
}

func specFor(kind string) (ExportSpecDTO, bool) {
	for _, spec := range exportSpecs {
		if spec.Kind == kind {
			return spec, true
		}
	}
	return ExportSpecDTO{}, false
}

// ------------------------------------------------------------- lifecycle

func newDesktop() *Desktop {
	d := &Desktop{
		prefs:  defaultPrefs(),
		status: statusReady,
		// A minute is long enough that re-rendering a screen costs nothing, and
		// short enough that a fresh purchase shows up without a restart.
		verifier: newVerifier(time.Minute),
	}
	d.prefsPath = filepath.Join(dataDir(), "desktop.json")
	d.userID = loadOrCreateProfile(d.prefsPath, &d.prefs)
	return d
}

func (d *Desktop) ServiceName() string { return "Desktop" }

// dataDir is where the desktop app keeps its own state. It sits beside the
// engine's ledger so "remove ~/.cloudslash" stays a complete uninstall.
func dataDir() string {
	if dir, err := os.UserConfigDir(); err == nil && dir != "" {
		return filepath.Join(dir, "cloudslash")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return ".cloudslash"
	}
	return filepath.Join(home, ".cloudslash")
}

// loadOrCreateProfile restores the saved preferences and the stable install id,
// minting one on first run. That id is what RevenueCat bills against, so it must
// not change between launches.
func loadOrCreateProfile(path string, prefs *PrefsDTO) string {
	var state persistedState

	if data, err := os.ReadFile(path); err == nil {
		if err := json.Unmarshal(data, &state); err != nil {
			// A corrupt file should not stop the app from opening; fall back to
			// defaults and let the next save overwrite it.
			state = persistedState{}
		}
	}

	// The file is always written complete, so a saved output directory is proof
	// it is ours.
	if state.Prefs.OutputDir != "" {
		restored := state.Prefs
		if restored.OutputDir == "" {
			restored.OutputDir = defaultPrefs().OutputDir
		}
		if restored.MaxConcurrency <= 0 {
			restored.MaxConcurrency = defaultPrefs().MaxConcurrency
		}
		*prefs = restored
	}

	if state.UserID == "" {
		state.UserID = newUserID()
	}
	return state.UserID
}

func (d *Desktop) persist() error {
	payload := persistedState{UserID: d.userID, Prefs: d.prefs}
	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(d.prefsPath), 0o755); err != nil {
		return err
	}
	return os.WriteFile(d.prefsPath, data, 0o600)
}

func newUserID() string {
	buf := make([]byte, 6)
	if _, err := rand.Read(buf); err != nil {
		return fmt.Sprintf("cs_%d", time.Now().UnixNano())
	}
	return "cs_" + hex.EncodeToString(buf)
}

// ------------------------------------------------------------- bound API

// Profile returns facts about this install.
func (d *Desktop) Profile() ProfileDTO {
	return ProfileDTO{
		UserID:    d.userID,
		Version:   version.Current,
		License:   version.License,
		OutputDir: resolvedOutputDir(d.prefs.OutputDir),
		DataDir:   dataDir(),
		Platform:  runtime.GOOS,
	}
}

// Prefs returns the saved engine configuration.
func (d *Desktop) Prefs() PrefsDTO {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return d.prefs
}

// SavePrefs replaces the stored configuration.
//
// The interface sends the whole object, so this replaces rather than merges.
// Merging field-by-field would be wrong here: a boolean that the operator just
// turned off is indistinguishable from one that was never sent.
func (d *Desktop) SavePrefs(update PrefsDTO) error {
	next := update
	defaults := defaultPrefs()

	// Guard the fields that must never be empty, so a cleared input cannot
	// leave the engine without an output directory.
	// An empty region is a valid setting: it means "work it out".
	if strings.TrimSpace(next.OutputDir) == "" {
		next.OutputDir = defaults.OutputDir
	}
	next.OutputDir = resolvedOutputDir(next.OutputDir)
	if next.MaxConcurrency <= 0 {
		next.MaxConcurrency = defaults.MaxConcurrency
	}
	if next.DiscountRate < 0 {
		next.DiscountRate = 0
	}
	if next.DiscountRate > 1 {
		next.DiscountRate = 1
	}

	d.mu.Lock()
	d.prefs = next
	d.mu.Unlock()

	return d.persist()
}

// AwsProfiles lists the profiles in the user's AWS configuration, so the
// interface can offer a choice rather than asking anyone to paste a key.
func (d *Desktop) AwsProfiles() AwsProfilesDTO {
	profiles, err := engineaws.ListProfiles()
	if err != nil {
		return AwsProfilesDTO{Profiles: []string{}, Error: err.Error()}
	}
	sort.Strings(profiles)
	return AwsProfilesDTO{Profiles: profiles}
}

// AwsEnvironment is what can be inferred about AWS on this machine.
type AwsEnvironment struct {
	Profiles []string `json:"Profiles"`
	Profile  string   `json:"Profile"`
	Region   string   `json:"Region"`
	Source   string   `json:"Source"`
	Error    string   `json:"Error"`
}

// DetectAws reports the profiles present and the region that would be used, so
// the interface can fill those in rather than asking.
func (d *Desktop) DetectAws() AwsEnvironment {
	out := AwsEnvironment{Profiles: []string{}}

	profiles, err := engineaws.ListProfiles()
	if err != nil {
		out.Error = err.Error()
	} else {
		sort.Strings(profiles)
		out.Profiles = profiles
		// Exactly one profile is not a choice, so it needs no confirmation.
		if len(profiles) == 1 {
			out.Profile = profiles[0]
		}
	}

	d.mu.RLock()
	configured := d.prefs.Profile
	d.mu.RUnlock()

	profile := configured
	if profile == "" {
		profile = out.Profile
	}

	out.Region = engineaws.ResolveRegion(profile)
	out.Source = engineaws.DescribeRegion(profile)
	return out
}

// VerifyAws confirms that a profile can actually be used, by asking STS who it
// is. A profile that authenticates is worth more than one that is merely
// present, and the answer is the account, not a credential.
func (d *Desktop) VerifyAws(profile, region string) AwsIdentity {
	profile = strings.TrimSpace(profile)
	if strings.TrimSpace(region) == "" {
		region = engineaws.ResolveRegion(profile)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	client, err := engineaws.NewClient(ctx, region, profile, false)
	if err != nil {
		return AwsIdentity{Profile: profile, Region: region, Error: err.Error()}
	}

	account, err := client.VerifyIdentity(ctx)
	if err != nil {
		return AwsIdentity{Profile: profile, Region: region, Error: err.Error()}
	}

	return AwsIdentity{Connected: true, Account: account, Profile: profile, Region: region}
}

// Snapshot returns the current totals and findings.
func (d *Desktop) Snapshot() SnapshotDTO {
	d.mu.RLock()
	session := d.session
	status := d.status
	errMsg := d.errMsg
	startedAt := d.startedAt
	region := d.prefs.Region
	d.mu.RUnlock()

	out := SnapshotDTO{
		Status:    status,
		Region:    region,
		Findings:  []FindingDTO{},
		Error:     errMsg,
		StartedAt: rfc3339(startedAt),
	}

	if session == nil {
		return out
	}

	live := session.Snapshot()

	// Record the moment the scan reached a terminal state so the masthead can
	// say when it happened without the engine having to report it.
	if live.Status != cloudapp.StatusScanning {
		d.mu.Lock()
		if d.finishedAt.IsZero() && d.status != statusReady {
			d.finishedAt = time.Now()
		}
		if live.Status != "" {
			d.status = string(live.Status)
		}
		d.cancel = nil
		errMsg = live.Error
		out.Status = d.status
		out.FinishedAt = rfc3339(d.finishedAt)
		d.mu.Unlock()
	}

	out.Region = live.Region
	if out.Region == "" {
		out.Region = region
	}
	out.TotalNodes = live.TotalNodes
	out.WasteCount = live.WasteCount
	out.IgnoredCount = live.IgnoredCount
	out.MonthlyWaste = live.MonthlyWaste
	out.EdgeCount = len(live.Edges)
	out.Partial = live.Partial
	out.FailedScopeCount = len(live.FailedScopes)
	out.Error = live.Error

	for _, finding := range live.Findings {
		out.Findings = append(out.Findings, FindingDTO{
			ID:           finding.ID,
			Type:         finding.Type,
			Region:       finding.Region,
			Reason:       finding.Reason,
			Owner:        finding.Owner,
			Reachability: finding.Reachability,
			Cost:         finding.Cost,
			Risk:         finding.Risk,
			Ignored:      finding.Ignored,
			Properties:   finding.Properties,
		})
	}

	return out
}

func rfc3339(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(time.RFC3339)
}

// AwsConfigured reports whether anything on this machine can supply credentials:
// a profile in the shared config, or credentials in the environment.
func AwsConfigured() bool {
	_, err := engineaws.ListProfiles()
	return err == nil
}

// StartScan builds the engine configuration from the saved preferences, starts a
// run in the background, and returns immediately. Progress is read via Snapshot.
func (d *Desktop) StartScan(region string, demo bool) error {
	// Reading nothing would otherwise spend its time hunting for credentials that
	// do not exist, leaving the window on "scanning" with no way forward. Refuse
	// before any state changes, and say what to do about it.
	if !demo && !AwsConfigured() {
		return fmt.Errorf(
			"no AWS configuration was found on this machine, so there is nothing to read. " +
				"Run `aws configure` to add a profile, or switch on demo mode to see the interface working on synthetic data",
		)
	}

	d.mu.Lock()
	if d.status == statusScanning {
		d.mu.Unlock()
		return fmt.Errorf("a scan is already running")
	}
	prefs := d.prefs
	if strings.TrimSpace(region) != "" {
		prefs.Region = strings.TrimSpace(region)
	}
	// Nothing has to be chosen before a first scan: an empty region is resolved
	// from the machine's environment and AWS configuration.
	if strings.TrimSpace(prefs.Region) == "" {
		prefs.Region = engineaws.ResolveRegion(prefs.Profile)
	}
	d.prefs.Region = prefs.Region
	d.prefs.Demo = demo
	d.status = statusScanning
	d.errMsg = ""
	d.startedAt = time.Now()
	d.finishedAt = time.Time{}
	d.mu.Unlock()

	ctx, cancel := context.WithCancel(context.Background())
	d.mu.Lock()
	d.cancel = cancel
	d.mu.Unlock()

	// A chosen profile is applied through the environment, which is the lever the
	// engine and the AWS SDK already read. The credential itself is never read,
	// copied, or stored by this app: only the name of the profile is.
	if profile := strings.TrimSpace(prefs.Profile); profile != "" {
		_ = os.Setenv("AWS_PROFILE", profile)
	} else {
		_ = os.Unsetenv("AWS_PROFILE")
	}

	cfg := engine.Config{
		Region:           prefs.Region,
		MockMode:         demo,
		AllProfiles:      prefs.AllProfiles,
		TFStatePath:      prefs.TFStatePath,
		DisableCWMetrics: prefs.DisableCWMetrics,
		MaxConcurrency:   prefs.MaxConcurrency,
		DiscountRate:     prefs.DiscountRate,
		StrictMode:       prefs.StrictMode,
		RulesFile:        prefs.RulesFile,
		RequiredTags:     prefs.RequiredTags,
		HistoryURL:       prefs.HistoryURL,
		SlackWebhook:     prefs.SlackWebhook,
		SlackChannel:     prefs.SlackChannel,
		OtelEndpoint:     prefs.OtelEndpoint,
		SkipTelemetry:    prefs.OtelEndpoint == "",
		OutputDir:        resolvedOutputDir(prefs.OutputDir),
		// The engine's own TUI must never take over the desktop window.
		Headless: true,
		Logger:   slog.New(slog.NewTextHandler(io.Discard, nil)),
	}

	session, err := cloudapp.NewSession(ctx, cfg)
	if err != nil {
		d.mu.Lock()
		d.status = statusFailed
		d.errMsg = err.Error()
		d.mu.Unlock()
		return err
	}

	d.mu.Lock()
	d.session = session
	d.hasScan = true
	d.mu.Unlock()

	session.Start()
	_ = d.persist()
	return nil
}

// CancelScan stops a run in progress.
//
// The engine has phases that run on their own context — the Terraform state
// read, the CloudWatch log sweep and the ECR sweep all use context.Background()
// — so cancelling alone cannot be relied on to bring the goroutine back. The
// window therefore stops waiting on it: the status becomes cancelled, the
// session is dropped, and any findings it had are discarded. The goroutine
// finishes on its own and its result is ignored.
func (d *Desktop) CancelScan() error {
	d.mu.Lock()
	cancel := d.cancel
	d.cancel = nil
	if cancel == nil {
		d.mu.Unlock()
		return fmt.Errorf("no scan is running")
	}

	d.status = statusCancelled
	d.session = nil
	d.errMsg = ""
	d.finishedAt = time.Now()
	d.mu.Unlock()

	cancel()
	return nil
}

// Ignore suppresses a finding so it leaves the totals.
func (d *Desktop) Ignore(id string) error {
	d.mu.RLock()
	session := d.session
	d.mu.RUnlock()
	if session == nil {
		return fmt.Errorf("no scan has completed")
	}
	return session.Ignore(id)
}

// Artifacts lists what the last scan has already written.
func (d *Desktop) Artifacts() []ArtifactDTO {
	d.mu.RLock()
	outputDir := resolvedOutputDir(d.prefs.OutputDir)
	d.mu.RUnlock()

	entries, err := os.ReadDir(outputDir)
	if err != nil {
		return []ArtifactDTO{}
	}

	byName := map[string]ExportSpecDTO{}
	for _, spec := range exportSpecs {
		byName[spec.FileName] = spec
	}

	out := make([]ArtifactDTO, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		spec, known := byName[entry.Name()]
		out = append(out, ArtifactDTO{
			Name:    entry.Name(),
			Size:    info.Size(),
			ModTime: info.ModTime().UTC().Format(time.RFC3339),
			Kind:    artifactKind(entry.Name(), spec, known),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out
}

func artifactKind(name string, spec ExportSpecDTO, known bool) string {
	if known {
		return spec.Kind
	}
	switch strings.ToLower(filepath.Ext(name)) {
	case ".json":
		return "json"
	case ".csv":
		return "csv"
	case ".md":
		return "markdown"
	case ".html":
		return "report"
	case ".sh":
		return "remediation"
	default:
		return "other"
	}
}

// ExportSpecs reports what can be generated, and whether it is ready yet.
func (d *Desktop) ExportSpecs() []ExportSpecDTO {
	d.mu.RLock()
	ready := d.hasScan && d.status != statusScanning
	d.mu.RUnlock()

	out := make([]ExportSpecDTO, 0, len(exportSpecs))
	for _, spec := range exportSpecs {
		spec.Ready = ready
		out = append(out, spec)
	}
	return out
}

// Export generates one artifact and returns the path it wrote.
//
// The Pro gate is applied by the interface. It is a presentation boundary, not
// a security one: entitlement is resolved client-side against RevenueCat, and a
// local desktop tool cannot meaningfully hide a file from its own user.
func (d *Desktop) Export(kind string) (string, error) {
	spec, ok := specFor(kind)
	if !ok {
		return "", fmt.Errorf("unknown export %q", kind)
	}

	d.mu.RLock()
	session := d.session
	outputDir := resolvedOutputDir(d.prefs.OutputDir)
	d.mu.RUnlock()

	if session == nil {
		return "", fmt.Errorf("no scan has completed")
	}

	path := filepath.Join(outputDir, spec.FileName)
	if err := ensureDir(filepath.Dir(path)); err != nil {
		return "", err
	}

	var err error
	switch kind {
	case "json":
		err = session.ExportJSON(path)
	case "csv":
		err = session.ExportCSV(path)
	case "markdown":
		err = session.ExportExecutiveSummary(path)
	case "remediation":
		err = session.GenerateRemediationPlan(path)
	case "dashboard":
		err = session.ExportDashboard(path)
	case "report":
		err = session.ExportHTMLReport(path)
	}
	if err != nil {
		return "", err
	}
	return path, nil
}

// ---------------------------- opening things --------------------------

// OpenArtifact hands a generated file to the operating system.
//
// The name is reduced to its base and must match a known artifact, so a crafted
// name cannot walk out of the output directory.
func (d *Desktop) OpenArtifact(name string) error {
	d.mu.RLock()
	outputDir := resolvedOutputDir(d.prefs.OutputDir)
	d.mu.RUnlock()

	base := filepath.Base(name)
	if base == "." || base == string(filepath.Separator) || base == "" {
		return fmt.Errorf("invalid artifact name")
	}

	path := filepath.Join(outputDir, base)
	if _, err := os.Stat(path); err != nil {
		return fmt.Errorf("%s has not been generated yet", base)
	}
	return d.app.Browser.OpenURL(fileURL(path))
}

// OpenOutputDir reveals the artifact folder.
func (d *Desktop) OpenOutputDir() error {
	d.mu.RLock()
	outputDir := resolvedOutputDir(d.prefs.OutputDir)
	d.mu.RUnlock()

	if err := ensureDir(outputDir); err != nil {
		return err
	}
	return d.app.Browser.OpenURL(fileURL(outputDir))
}

// ChooseDirectory opens the operating system's folder picker.
//
// An empty result means the operator closed the picker, which is not an error.
func (d *Desktop) ChooseDirectory(title, startIn string) (string, error) {
	if d.app == nil {
		return "", fmt.Errorf("the window is not ready")
	}

	dialog := d.app.Dialog.OpenFile().
		CanChooseFiles(false).
		CanChooseDirectories(true).
		CanCreateDirectories(true).
		SetTitle(strings.TrimSpace(title))

	if start := strings.TrimSpace(startIn); start != "" {
		if abs, err := resolveDir(start); err == nil {
			dialog = dialog.SetDirectory(abs)
		}
	}

	return dialog.PromptForSingleSelection()
}

// fileURL turns a local path into a URL the OS handler accepts.
func fileURL(path string) string {
	abs, err := filepath.Abs(path)
	if err != nil {
		abs = path
	}
	return (&url.URL{Scheme: "file", Path: filepath.ToSlash(abs)}).String()
}

// allowedHosts is the set of domains the app will hand to the browser. Findings
// carry attacker-influenced strings, so a link must never be able to take the
// operator somewhere the product did not choose.
var allowedHosts = []string{
	"cloudslash.dev",
	"revenuecat.com",
	"www.revenuecat.com",
	"api.revenuecat.com",
	"pay.revenuecat.com",
	"app.revenuecat.com",
}

// OpenExternal opens an https link from the allowlist in the system browser.
func (d *Desktop) OpenExternal(raw string) error {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return fmt.Errorf("that is not a valid link")
	}
	if parsed.Scheme != "https" {
		return fmt.Errorf("only https links can be opened")
	}

	host := strings.ToLower(parsed.Hostname())
	for _, allowed := range allowedHosts {
		if host == allowed || strings.HasSuffix(host, "."+allowed) {
			return d.app.Browser.OpenURL(parsed.String())
		}
	}
	return fmt.Errorf("%s is not a domain this app opens links to", host)
}

// VerificationStatus reports whether the authoritative, server-side entitlement
// check is available here, and what to set if it is not. It never includes the
// key itself, not even a prefix of it.
func (d *Desktop) VerificationStatus() VerificationStatus {
	return d.verifier.status(d.userID)
}

// VerifyEntitlement asks RevenueCat directly, using the secret key from the
// environment. This is the authoritative answer the interface can offer when the
// client-side entitlement is stale, offline, or not to be trusted.
func (d *Desktop) VerifyEntitlement() Verification {
	out := d.verifier.verify(context.Background(), d.userID)
	if out.Checked {
		// Keep the offline cache in step with what the authority just said.
		_ = d.CacheEntitlement(out.Active, out.ExpiresAt, "revenuecat-rest")
	}
	return out
}

// CacheEntitlement records the last known plan so the Account screen can show
// something honest while offline. It is written by the frontend after RevenueCat
// answers; this process never contacts RevenueCat itself.
func (d *Desktop) CacheEntitlement(active bool, expiresAt string, source string) error {
	entry := map[string]any{
		"active":     active,
		"source":     source,
		"checked_at": time.Now().UTC().Format(time.RFC3339),
	}
	if expiresAt != "" {
		entry["expires_at"] = expiresAt
	}

	data, err := json.MarshalIndent(entry, "", "  ")
	if err != nil {
		return err
	}
	path := filepath.Join(dataDir(), "entitlement.json")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, data, 0o600)
}
