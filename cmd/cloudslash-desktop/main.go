// Command cloudslash-desktop is the CloudSlash graphical application: a
// local-first statement of the cloud spend you are paying for and not using.
//
// The window is a webview rendering the bundle in frontend/dist, and the only
// bridge between it and the engine is the Desktop service in service.go. There
// is no HTTP server, no port, and nothing listening.
package main

import (
	"embed"
	"fmt"
	"io/fs"
	"log"
	"reflect"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// The built interface is embedded into the binary. frontend/dist is produced by
// `npm run build` inside frontend/, and is kept present by a placeholder so a
// fresh checkout still compiles.
//
//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// The bundle lives under frontend/dist in the module, but the asset server
	// serves the root of the filesystem it is given.
	bundle, err := fs.Sub(assets, "frontend/dist")
	if err != nil {
		log.Fatalf("cloudslash: could not mount the interface bundle: %v", err)
	}

	service := newDesktop()

	app := application.New(application.Options{
		Name:        "CloudSlash",
		Description: "Autonomous cloud waste detection",
		Services: []application.Service{
			application.NewServiceWithOptions(service, application.ServiceOptions{Name: "Desktop"}),
		},
		Assets: application.AssetOptions{
			Handler: application.BundledAssetFileServer(bundle),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	// The service needs the application handle to hand links and generated
	// artifacts to the operating system.
	service.app = app

	// Wails addresses a bound method as "<package path>.<Type>.<Method>", built
	// from reflection. The interface hard-codes the same prefix in
	// frontend/src/lib/bridge.ts, so print it: if the two ever drift, the app
	// silently drops to preview data, and this line makes that a one-glance fix.
	log.Printf("cloudslash: services bound as %s.<Method>", bindingPrefix(service))

	// Say whether the optional server-side entitlement check is live. The key is
	// never printed, only whether one was found.
	if status := service.VerificationStatus(); status.Available {
		log.Printf("cloudslash: authoritative RevenueCat verification is enabled (%s)", status.EnvVar)
	} else {
		log.Printf("cloudslash: authoritative RevenueCat verification is off (%s unset)", status.EnvVar)
	}

	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:     "CloudSlash",
		Width:     1440,
		Height:    920,
		MinWidth:  920,
		MinHeight: 640,
		URL:       "/",
	})

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}

// bindingPrefix reports how Wails will name this service's methods, using the
// same reflection the binding layer uses.
func bindingPrefix(service any) string {
	t := reflect.TypeOf(service)
	if t == nil || t.Kind() != reflect.Pointer {
		return "<unknown>"
	}
	return fmt.Sprintf("%s.%s", t.Elem().PkgPath(), t.Elem().Name())
}
