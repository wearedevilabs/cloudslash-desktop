package main

import (
	"image/color"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/canvas"
	"fyne.io/fyne/v2/container"
	"fyne.io/fyne/v2/widget"
)

// newMarkdown builds a RichText that wraps. Fyne's RichText defaults to
// TextWrapOff, which makes long lines force the whole layout wider than the
// window and clip the header.
func newMarkdown(markdown string) *widget.RichText {
	rt := widget.NewRichTextFromMarkdown(markdown)
	rt.Wrapping = fyne.TextWrapWord
	return rt
}

// surface wraps content in a rounded panel with a subtle border.
func surface(objects ...fyne.CanvasObject) fyne.CanvasObject {
	bg := canvas.NewRectangle(colSurface)
	bg.CornerRadius = 12
	bg.StrokeColor = colBorder
	bg.StrokeWidth = 1
	return container.NewStack(bg, container.NewPadded(container.NewVBox(objects...)))
}

// surfaceBorder is a rounded panel that gives its centre object the remaining
// space, which is what bounded widgets such as lists need.
func surfaceBorder(top, bottom, centre fyne.CanvasObject) fyne.CanvasObject {
	bg := canvas.NewRectangle(colSurface)
	bg.CornerRadius = 12
	bg.StrokeColor = colBorder
	bg.StrokeWidth = 1
	return container.NewStack(bg, container.NewBorder(top, bottom, nil, nil, container.NewPadded(centre)))
}

// sectionTitle renders an accent bar plus a small caps heading.
func sectionTitle(title string) fyne.CanvasObject {
	bar := canvas.NewRectangle(colAccent)
	bar.CornerRadius = 2
	bar.SetMinSize(fyne.NewSize(3, 16))

	label := text(title, 13, fyne.TextStyle{Bold: true}, colText)
	return container.NewHBox(container.NewCenter(bar), label)
}

// statTile is a KPI card: a large value over a caption.
func statTile(caption, value string, accent color.Color) fyne.CanvasObject {
	valueText := text(value, 26, fyne.TextStyle{Bold: true}, accent)
	captionText := text(caption, 11, fyne.TextStyle{}, colMuted)

	bg := canvas.NewRectangle(colSurfaceAlt)
	bg.CornerRadius = 10
	return container.NewStack(bg, container.NewPadded(container.NewVBox(captionText, valueText)))
}

// badge renders a small rounded label, e.g. a risk pill or plan tag.
func badge(label string, bg color.Color, fg color.Color) fyne.CanvasObject {
	rect := canvas.NewRectangle(bg)
	rect.CornerRadius = 8
	t := text(label, 11, fyne.TextStyle{Bold: true}, fg)
	return container.NewStack(rect, container.NewPadded(container.NewCenter(t)))
}

// emptyState is the standard "nothing here yet" panel with a hint.
func emptyState(title, body string) fyne.CanvasObject {
	titleText := widget.NewLabelWithStyle(title, fyne.TextAlignCenter, fyne.TextStyle{Bold: true})
	titleText.Wrapping = fyne.TextWrapWord
	bodyText := widget.NewLabelWithStyle(body, fyne.TextAlignCenter, fyne.TextStyle{})
	bodyText.Wrapping = fyne.TextWrapWord
	bodyText.Importance = widget.LowImportance
	return container.NewCenter(container.NewVBox(titleText, bodyText))
}

// keyValue renders an aligned key/value row.
func keyValue(key, value string) fyne.CanvasObject {
	k := text(key, 12, fyne.TextStyle{}, colMuted)
	v := widget.NewLabel(value)
	v.Wrapping = fyne.TextWrapWord
	return container.NewGridWithColumns(2, k, v)
}
