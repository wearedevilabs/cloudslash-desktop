package commands

import (
	"fmt"
	"io"
	"log/slog"

	"github.com/DrSkyle/cloudslash/v2/pkg/engine"
	"github.com/spf13/cobra"
)

var exportFormat string
var exportPath string

var ExportCmd = &cobra.Command{
	Use:   "export",
	Short: "Export forensic data (CSV, JSON)",
	Long: `Run a scan and export the results to a specified format.
    
Default output directory: ./cloudslash-out/`,
	Run: func(cmd *cobra.Command, args []string) {
		fmt.Println("Initializing Forensic Export...")
		config.Headless = true
		// Ensure the engine always has a logger; export is a quiet, headless flow.
		if config.Logger == nil {
			config.Logger = slog.New(slog.NewTextHandler(io.Discard, nil))
		}
		// Execute a full scan to generate the report data.
		eng, err := engine.New(cmd.Context(),
			engine.WithLogger(config.Logger),
			engine.WithConfig(config),
			engine.WithConcurrency(config.MaxConcurrency),
		)
		if err != nil {
			fmt.Printf("\n[ERROR] Export Failed (Init): %v\n", err)
			return
		}
		_, _, _, err = eng.Run(cmd.Context())
		if err != nil {
			fmt.Printf("\n[ERROR] Export Failed: %v\n", err)
			return
		}

		fmt.Println("\n[SUCCESS] Export Complete.")
		fmt.Println("   CSV:  ./cloudslash-out/waste_report.csv")
		fmt.Println("   JSON: ./cloudslash-out/waste_report.json")
		fmt.Println("   HTML: ./cloudslash-out/dashboard.html")
	},
}

func init() {
}
