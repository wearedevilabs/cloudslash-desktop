// Command cloudslash-desktop is the CloudSlash graphical application: a
// local-first dashboard for detecting and remediating cloud waste.
package main

import (
	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/app"
)

func main() {
	application := app.NewWithID("io.cloudslash.desktop")
	application.Settings().SetTheme(cloudTheme{})

	window := application.NewWindow("CloudSlash Desktop")
	window.Resize(fyne.NewSize(1440, 920))
	window.CenterOnScreen()

	desktop := newDesktop(application, window)
	desktop.build()

	window.ShowAndRun()
}
