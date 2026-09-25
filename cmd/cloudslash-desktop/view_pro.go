package main

import (
	"context"
	"fmt"
	"strings"
	"time"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/container"
	"fyne.io/fyne/v2/dialog"
	"fyne.io/fyne/v2/theme"
	"fyne.io/fyne/v2/widget"

	"github.com/DrSkyle/cloudslash/v2/pkg/billing"
	"github.com/DrSkyle/cloudslash/v2/pkg/version"
)

// trialDuration is how long the local demo unlock lasts.
const trialDuration = 7 * 24 * time.Hour

// proScreen is the account screen: plan status, RevenueCat connection and trial.
func (d *Desktop) proScreen() fyne.CanvasObject {
	planCard := surface(
		container.NewBorder(nil, nil, sectionTitle("SUBSCRIPTION"), d.proPlanBadge),
		d.proStatus,
		container.NewGridWithColumns(3,
			widget.NewButtonWithIcon("Refresh status", theme.ViewRefreshIcon(), d.refreshBillingStatus),
			widget.NewButtonWithIcon("Start 7-day demo trial", theme.MediaPlayIcon(), d.startTrial),
			widget.NewButtonWithIcon("End trial", theme.ContentClearIcon(), d.endTrial),
		),
	)

	features := surface(
		sectionTitle("WHAT PRO UNLOCKS"),
		newMarkdown(
			"- **Remediation plans**: generate the Lazarus Protocol remediation plan for every finding.\n"+
				"- **Executive dashboard**: self-contained HTML dashboard with cost-flow charts.\n"+
				"- **Analysis report**: portable HTML report you can attach to a review or ticket.\n\n"+
				"The free tier keeps scanning, findings, topology and the JSON/CSV exports available.",
		),
	)

	connection := surface(
		sectionTitle("REVENUECAT CONNECTION"),
		text("CloudSlash reads entitlements from the RevenueCat REST API v1, which needs a secret API key for the same project your mobile app uses. Prefer the REVENUECAT_SECRET_KEY environment variable over typing it here.", 12, fyne.TextStyle{}, colMuted),
		container.NewVBox(text("Secret API key", 11, fyne.TextStyle{}, colMuted), d.apiKeyEntry),
		container.NewVBox(text("App User ID", 11, fyne.TextStyle{}, colMuted), d.appUserEntry),
		container.NewVBox(text("Entitlement identifier", 11, fyne.TextStyle{}, colMuted), d.entitlementEntry),
		container.NewVBox(text("Upgrade URL (optional)", 11, fyne.TextStyle{}, colMuted), d.purchaseURL),
		container.NewGridWithColumns(2,
			widget.NewButtonWithIcon("Save & verify", theme.ConfirmIcon(), d.saveBilling),
			widget.NewButtonWithIcon("Manage subscription", theme.LoginIcon(), d.openManagement),
		),
	)

	about := surface(
		sectionTitle("ABOUT"),
		newMarkdown(fmt.Sprintf(
			"**CloudSlash Desktop**: autonomous cloud waste detection.\n\n"+
				"- Version: `%s`\n- License: %s\n- Analysis is local-first; nothing is uploaded.",
			version.Current,
			version.License,
		)),
	)

	body := container.NewVBox(planCard, features, connection, about)
	return container.NewVScroll(container.NewPadded(body))
}

// isPro reports whether Pro features are currently unlocked.
func (d *Desktop) isPro() bool {
	return d.billing.Status().Pro
}

// refreshBilling re-renders the plan badge, status panel and header chip.
func (d *Desktop) refreshBilling() {
	status := d.billing.Status()

	if d.proPlanBadge != nil {
		if status.Pro {
			d.proPlanBadge.Objects = []fyne.CanvasObject{badge("PRO", colAccentDim, colText)}
		} else {
			d.proPlanBadge.Objects = []fyne.CanvasObject{badge("FREE", colSurfaceAlt, colMuted)}
		}
		d.proPlanBadge.Refresh()
	}

	if d.headerBadge != nil {
		if status.Pro {
			d.headerBadge.Objects = []fyne.CanvasObject{badge("PRO", colAccentDim, colText)}
		} else {
			d.headerBadge.Objects = []fyne.CanvasObject{badge("FREE", colSurfaceAlt, colMuted)}
		}
		d.headerBadge.Refresh()
	}

	if d.proStatus == nil {
		return
	}

	var b strings.Builder
	if status.Pro {
		b.WriteString("### Pro is active\n\n")
	} else {
		b.WriteString("### Free plan\n\n")
	}

	switch status.Source {
	case billing.SourceRevenueCat:
		b.WriteString("Verified against RevenueCat.\n\n")
	case billing.SourceTrial:
		if status.TrialExpires != nil {
			fmt.Fprintf(&b, "Unlocked by a local demo trial until **%s**.\n\n", status.TrialExpires.Format("2 Jan 2006 15:04"))
		} else {
			b.WriteString("Unlocked by a local demo trial.\n\n")
		}
	default:
		b.WriteString("Connect RevenueCat below, or start a demo trial to preview the Pro features.\n\n")
	}

	fmt.Fprintf(&b, "- Entitlement: `%s`\n", status.EntitlementID)
	fmt.Fprintf(&b, "- Configured: %s\n", yesNo(status.Configured))
	if status.CheckedAt.IsZero() {
		b.WriteString("- Last verified: never\n")
	} else {
		fmt.Fprintf(&b, "- Last verified: %s\n", relTime(status.CheckedAt))
	}
	if status.Customer != nil && status.Customer.ManagementURL != "" {
		b.WriteString("- Management URL available\n")
	}
	if status.Error != "" {
		fmt.Fprintf(&b, "\n**Lookup problem:** %s\n", status.Error)
	}
	if ent, ok := d.entitlementSummary(); ok {
		fmt.Fprintf(&b, "\n**Entitlement `%s`:** %s", ent.Identifier, ent.State)
	}

	d.proStatus.ParseMarkdown(b.String())
}

type entitlementSummary struct {
	Identifier string
	State      string
}

func (d *Desktop) entitlementSummary() (entitlementSummary, bool) {
	status := d.billing.Status()
	if status.Customer == nil {
		return entitlementSummary{}, false
	}
	ent, ok := status.Customer.Entitlements[status.EntitlementID]
	if !ok {
		return entitlementSummary{}, false
	}
	state := "inactive"
	if ent.Active(time.Now()) {
		if ent.ExpiresDate != nil {
			state = "active until " + ent.ExpiresDate.Format("2 Jan 2006")
		} else {
			state = "active (lifetime)"
		}
	} else if ent.ExpiresDate != nil {
		state = "expired " + ent.ExpiresDate.Format("2 Jan 2006")
	}
	return entitlementSummary{Identifier: ent.Identifier, State: state}, true
}

func (d *Desktop) saveBilling() {
	d.billing.SetConfig(billing.Config{
		APIKey:        strings.TrimSpace(d.apiKeyEntry.Text),
		AppUserID:     strings.TrimSpace(d.appUserEntry.Text),
		EntitlementID: strings.TrimSpace(d.entitlementEntry.Text),
	})
	d.refreshBilling()
	d.refreshBillingStatus()
}

func (d *Desktop) refreshBillingStatus() {
	if !d.billing.Config().Configured() {
		d.refreshBilling()
		dialog.ShowInformation("RevenueCat not configured",
			"Enter a RevenueCat public API key and App User ID, then choose Save & verify.", d.win)
		return
	}
	go func() {
		status := d.billing.Refresh(context.Background())
		fyne.Do(func() {
			d.refreshBilling()
			if status.Error != "" {
				dialog.ShowError(fmt.Errorf("revenuecat lookup failed: %s", status.Error), d.win)
			}
		})
	}()
}

func (d *Desktop) startTrial() {
	d.billing.StartTrial(trialDuration)
	d.refreshBilling()
	dialog.ShowInformation("Demo trial started",
		fmt.Sprintf("Pro features are unlocked for %d days on this machine. No payment is involved.", int(trialDuration.Hours()/24)), d.win)
}

func (d *Desktop) endTrial() {
	d.billing.ClearTrial()
	d.refreshBilling()
}

func (d *Desktop) openManagement() {
	status := d.billing.Status()
	target := strings.TrimSpace(d.purchaseURL.Text)
	if status.Customer != nil && status.Customer.ManagementURL != "" {
		target = status.Customer.ManagementURL
	}
	if target == "" {
		dialog.ShowInformation("No link available",
			"Add an upgrade URL above, or verify a subscription so RevenueCat can report its management URL.", d.win)
		return
	}
	if err := openInBrowser(target); err != nil {
		dialog.ShowInformation("Could not open link", target, d.win)
	}
}

// showPaywall explains which feature is gated and offers to open the Pro screen.
func (d *Desktop) showPaywall(feature string) {
	confirm := dialog.NewConfirm(
		"Pro feature",
		fmt.Sprintf("%s is part of CloudSlash Pro.\n\nStart a 7-day demo trial or connect a RevenueCat subscription to unlock it.", feature),
		func(ok bool) {
			if ok {
				d.navigate(len(d.screens) - 1)
			}
		},
		d.win,
	)
	confirm.SetConfirmText("View Pro plan")
	confirm.SetDismissText("Not now")
	confirm.Show()
}

func yesNo(v bool) string {
	if v {
		return "yes"
	}
	return "no"
}
