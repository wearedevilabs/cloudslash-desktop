package app

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"sync"
	"time"

	"github.com/DrSkyle/cloudslash/v2/pkg/engine"
	"github.com/DrSkyle/cloudslash/v2/pkg/engine/remediation"
	"github.com/DrSkyle/cloudslash/v2/pkg/engine/report"
	"github.com/DrSkyle/cloudslash/v2/pkg/graph"
)

// errNoScan is returned when an export is requested before a scan has completed.
var errNoScan = errors.New("no scan has completed")

// Status describes the lifecycle of a scan for any UI consumer.
type Status string

const (
	StatusReady     Status = "ready"
	StatusScanning  Status = "scanning"
	StatusComplete  Status = "complete"
	StatusCancelled Status = "cancelled"
	StatusFailed    Status = "failed"
)

// Finding is a presentation-neutral view of a waste node.
type Finding struct {
	ID           string
	Type         string
	Region       string
	Reason       string
	Owner        string
	Cost         float64
	Risk         int
	Reachability string
	Ignored      bool
	Properties   map[string]interface{}
}

// Snapshot is the read model shared by desktop, future web, and other clients.
type Snapshot struct {
	Status       Status
	Region       string
	TotalNodes   int
	WasteCount   int
	IgnoredCount int
	MonthlyWaste float64
	Findings     []Finding
	Edges        []graph.Edge
	Partial      bool
	FailedScopes []graph.ScopeError
	Error        string
}

// Session owns a single core engine run and exposes safe UI-facing operations.
type Session struct {
	mu     sync.RWMutex
	ctx    context.Context
	config engine.Config
	core   *engine.Engine
	graph  *graph.Graph
	status Status
	err    error
}

func NewSession(ctx context.Context, cfg engine.Config) (*Session, error) {
	if cfg.Logger == nil {
		cfg.Logger = slog.New(slog.NewTextHandler(nil, nil))
	}
	core, err := engine.New(ctx, engine.WithConfig(cfg), engine.WithLogger(cfg.Logger), engine.WithConcurrency(cfg.MaxConcurrency))
	if err != nil {
		return nil, err
	}
	return &Session{ctx: ctx, config: cfg, core: core, status: StatusReady}, nil
}

// Start begins the scan without blocking the calling UI thread.
func (s *Session) Start() {
	s.mu.Lock()
	if s.status == StatusScanning {
		s.mu.Unlock()
		return
	}
	s.status = StatusScanning
	s.mu.Unlock()

	go func() {
		_, scannedGraph, _, err := s.core.Run(s.ctx)

		if err == nil && s.ctx.Err() != nil {
			err = s.ctx.Err()
		}
		// The engine recovers its own panics, so a run that returns no graph and
		// no error has collapsed. Reporting that as a clean scan is a lie.
		if err == nil && scannedGraph == nil {
			err = errors.New("the scan stopped without collecting anything")
		}

		s.mu.Lock()
		s.graph = scannedGraph
		s.err = err
		switch {
		case errors.Is(err, context.Canceled):
			s.status = StatusCancelled
			s.err = nil
		case err != nil:
			s.status = StatusFailed
		default:
			s.status = StatusComplete
		}
		s.mu.Unlock()
	}()
}

func (s *Session) Snapshot() Snapshot {
	s.mu.RLock()
	status, err, g := s.status, s.err, s.graph
	s.mu.RUnlock()

	snapshot := Snapshot{Status: status}
	if err != nil {
		snapshot.Error = err.Error()
	}
	if g == nil {
		return snapshot
	}

	g.Mu.RLock()
	snapshot.Partial = g.Metadata.Partial
	snapshot.FailedScopes = append([]graph.ScopeError(nil), g.Metadata.FailedScopes...)
	for _, node := range g.Store.GetAllNodes() {
		snapshot.TotalNodes++
		if node.Ignored {
			snapshot.IgnoredCount++
		}
		if !node.IsWaste || node.Ignored {
			continue
		}
		snapshot.WasteCount++
		snapshot.MonthlyWaste += node.Cost
		snapshot.Findings = append(snapshot.Findings, findingFromNode(node))
		for _, edge := range g.Store.GetEdges(node.Index) {
			snapshot.Edges = append(snapshot.Edges, edge)
		}
	}
	g.Mu.RUnlock()
	sort.Slice(snapshot.Findings, func(i, j int) bool { return snapshot.Findings[i].Cost > snapshot.Findings[j].Cost })
	return snapshot
}

func findingFromNode(node *graph.Node) Finding {
	region, _ := node.Properties["Region"].(string)
	if region == "" {
		region, _ = node.Properties["region"].(string)
	}
	reason, _ := node.Properties["Reason"].(string)
	if reason == "" {
		reason = node.WasteReason
	}
	owner, _ := node.Properties["Owner"].(string)
	return Finding{ID: node.IDStr(), Type: node.TypeStr(), Region: region, Reason: reason, Owner: owner, Cost: node.Cost, Risk: node.RiskScore, Reachability: string(node.Reachability), Ignored: node.Ignored, Properties: cloneProperties(node.Properties)}
}

func cloneProperties(source map[string]interface{}) map[string]interface{} {
	copyOf := make(map[string]interface{}, len(source))
	for key, value := range source {
		copyOf[key] = value
	}
	return copyOf
}

func (s *Session) Ignore(id string) error {
	s.mu.RLock()
	g := s.graph
	s.mu.RUnlock()
	if g == nil {
		return fmt.Errorf("no scan has completed")
	}
	node := g.GetNode(id)
	if node == nil {
		return fmt.Errorf("resource %q was not found", id)
	}
	g.Store.UpdateNode(node.Index, func(updated *graph.Node) { updated.Ignored = true })
	return nil
}

func (s *Session) ExportJSON(path string) error {
	s.mu.RLock()
	g := s.graph
	s.mu.RUnlock()
	if g == nil {
		return fmt.Errorf("no scan has completed")
	}
	return report.GenerateJSON(g, path)
}

func (s *Session) ExportCSV(path string) error {
	s.mu.RLock()
	g := s.graph
	s.mu.RUnlock()
	if g == nil {
		return fmt.Errorf("no scan has completed")
	}
	return report.GenerateCSV(g, path)
}

func (s *Session) GenerateRemediationPlan(path string) error {
	s.mu.RLock()
	g := s.graph
	s.mu.RUnlock()
	if g == nil {
		return fmt.Errorf("no scan has completed")
	}
	return remediation.NewGenerator(g, nil).GenerateRemediationPlan(path)
}

// ExportHTMLReport writes the self-contained static analysis report.
func (s *Session) ExportHTMLReport(path string) error {
	g := s.currentGraph()
	if g == nil {
		return errNoScan
	}
	return report.GenerateHTML(g, path)
}

// ExportDashboard writes the interactive executive dashboard.
func (s *Session) ExportDashboard(path string) error {
	g := s.currentGraph()
	if g == nil {
		return errNoScan
	}
	return report.GenerateDashboard(g, path)
}

// ExportExecutiveSummary writes the markdown executive summary.
func (s *Session) ExportExecutiveSummary(path string) error {
	g := s.currentGraph()
	if g == nil {
		return errNoScan
	}
	scanID := fmt.Sprintf("cs-%d", time.Now().Unix())
	return report.GenerateExecutiveSummary(g, path, scanID, "local")
}

func (s *Session) currentGraph() *graph.Graph {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.graph
}
