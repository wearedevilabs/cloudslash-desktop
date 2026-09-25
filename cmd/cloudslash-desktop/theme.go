package main

import (
	"image/color"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/canvas"
	"fyne.io/fyne/v2/theme"
)

// CloudSlash palette. Kept deliberately small and high-contrast so the UI reads
// well on projectors and screenshots during a demo.
var (
	colBg         = color.NRGBA{R: 11, G: 15, B: 20, A: 255}
	colSurface    = color.NRGBA{R: 19, G: 24, B: 32, A: 255}
	colSurfaceAlt = color.NRGBA{R: 27, G: 33, B: 43, A: 255}
	colBorder     = color.NRGBA{R: 39, G: 47, B: 59, A: 255}

	colText  = color.NRGBA{R: 232, G: 238, B: 244, A: 255}
	colMuted = color.NRGBA{R: 139, G: 152, B: 165, A: 255}
	colFaint = color.NRGBA{R: 94, G: 105, B: 118, A: 255}

	colAccent    = color.NRGBA{R: 185, G: 242, B: 39, A: 255}
	colAccentDim = color.NRGBA{R: 108, G: 148, B: 24, A: 255}
	colDanger    = color.NRGBA{R: 255, G: 92, B: 108, A: 255}
	colWarn      = color.NRGBA{R: 245, G: 179, B: 1, A: 255}
	colInfo      = color.NRGBA{R: 96, G: 165, B: 250, A: 255}
	colPurple    = color.NRGBA{R: 167, G: 139, B: 250, A: 255}
)

// cloudTheme is the application theme: a flat, dark, high-contrast look.
type cloudTheme struct{}

func (cloudTheme) Color(name fyne.ThemeColorName, variant fyne.ThemeVariant) color.Color {
	switch name {
	case theme.ColorNameBackground:
		return colBg
	case theme.ColorNameForeground:
		return colText
	case theme.ColorNamePrimary:
		return colAccent
	case theme.ColorNameFocus:
		return colAccent
	case theme.ColorNameSelection:
		return colSurfaceAlt
	case theme.ColorNameHover:
		return colSurfaceAlt
	case theme.ColorNamePressed:
		return colBorder
	case theme.ColorNameButton:
		return colSurfaceAlt
	case theme.ColorNameDisabledButton:
		return colSurface
	case theme.ColorNameDisabled:
		return colFaint
	case theme.ColorNameInputBackground:
		return colSurfaceAlt
	case theme.ColorNameInputBorder:
		return colBorder
	case theme.ColorNameMenuBackground, theme.ColorNameOverlayBackground:
		return colSurface
	case theme.ColorNamePlaceHolder:
		return colFaint
	case theme.ColorNameSeparator:
		return colBorder
	case theme.ColorNameScrollBar:
		return colBorder
	case theme.ColorNameShadow:
		return color.NRGBA{A: 140}
	case theme.ColorNameError:
		return colDanger
	case theme.ColorNameSuccess:
		return colAccent
	case theme.ColorNameWarning:
		return colWarn
	case theme.ColorNameForegroundOnPrimary,
		theme.ColorNameForegroundOnSuccess,
		theme.ColorNameForegroundOnWarning,
		theme.ColorNameForegroundOnError:
		// Accent backgrounds are bright, so their text must be dark for contrast.
		return colBg
	default:
		return theme.DefaultTheme().Color(name, variant)
	}
}

func (cloudTheme) Font(style fyne.TextStyle) fyne.Resource {
	return theme.DefaultTheme().Font(style)
}

func (cloudTheme) Icon(name fyne.ThemeIconName) fyne.Resource {
	return theme.DefaultTheme().Icon(name)
}

func (cloudTheme) Size(name fyne.ThemeSizeName) float32 {
	switch name {
	case theme.SizeNamePadding:
		return 6
	case theme.SizeNameText:
		return 13
	case theme.SizeNameHeadingText:
		return 20
	case theme.SizeNameSubHeadingText:
		return 15
	default:
		return theme.DefaultTheme().Size(name)
	}
}

// text is a convenience constructor for a styled, single-line piece of text.
func text(value string, size float32, style fyne.TextStyle, col color.Color) *canvas.Text {
	t := canvas.NewText(value, col)
	t.TextSize = size
	t.TextStyle = style
	return t
}
