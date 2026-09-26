import { h } from "../lib/dom";
import { openExternal, openPaywall, refreshPlan, state } from "../lib/state";
import { environmentLabel, keyProblemMessage, managementTarget } from "../lib/billing";
import { num } from "../lib/format";
import { button, leaderRow, note, panel } from "../ui/bits";
import { icon } from "../ui/icons";
import type { View } from "../ui/contracts";

/**
 * Account: the plan, what it includes, and how to reach support.
 *
 * There is no key field and no card form. Entitlement comes from RevenueCat
 * through the web SDK against a publishable key, and payment happens on
 * RevenueCat's hosted checkout. Purchase controls live in the support dialog, so
 * this screen states and links rather than duplicating that path.
 */
export function createAccountView(): View {
  const el = h("div", { class: "view" });
  const inner = h("div", { class: "view__inner" });
  el.append(inner);

  function update(): void {
    const { plan, profile } = state;

    const sections: Node[] = [
      h(
        "div",
        { class: "view__title" },
        h("h1", {}, "Account"),
        plan.sandbox ? h("span", { class: "tag tag--alarm" }, environmentLabel(plan.environment)) : null,
      ),
      h(
        "p",
        { class: "view__lede" },
        "CloudSlash is free on every machine, and there is nothing to sign up for. Supporting it is optional and changes nothing about what you get.",
      ),
    ];

    /* -- plan, stated like a certificate ------------------------------- */
    // A donation leaves no account to describe. The only facts worth showing are
    // the two that matter if someone set up a recurring contribution, and none of
    // them mention who processes the payment.
    const planFacts: Node[] = [];
    if (plan.pro && plan.expiresAt) {
      planFacts.push(
        leaderRow(plan.willRenew ? "Renews" : "Ends", new Date(plan.expiresAt).toLocaleDateString()),
      );
    }

    const planActions = h("div", { class: "row-actions" });

    if (plan.loading || plan.checking) {
      planActions.append(h("span", { class: "t-small is-muted" }, plan.checking ? "Checking your plan…" : "Loading…"));
    } else if (!plan.configured) {
      // One support surface, always reachable. The dialog is where the billing
      // situation is explained, so this goes there rather than dead-ending on
      // the website.
      planActions.append(
        button({
          label: "Support CloudSlash",
          icon: "arrow",
          variant: "primary",
          onClick: () => openPaywall("Supporting CloudSlash"),
        }),
      );
    } else if (plan.pro) {
      const manage = managementTarget();
      if (manage) {
        planActions.append(
          button({ label: "Manage or cancel", icon: "external", onClick: () => void openExternal(manage) }),
        );
      }
      planActions.append(
        button({ label: "Check again", icon: "refresh", variant: "quiet", onClick: () => void refreshPlan() }),
      );
    } else if (plan.packages.length) {
      planActions.append(
        button({
          label: "Support CloudSlash",
          icon: "arrow",
          variant: "primary",
          onClick: () => openPaywall("Supporting CloudSlash"),
        }),
      );
      planActions.append(
        button({
          label: "Already supporting? Check again",
          icon: "refresh",
          variant: "quiet",
          onClick: () => void refreshPlan(),
        }),
      );
    } else {
      // Configured, but nothing published: offering support would open a dialog
      // with nothing in it, so the only useful action is to look again.
      planActions.append(
        button({ label: "Refresh", icon: "refresh", variant: "quiet", onClick: () => void refreshPlan() }),
      );
    }

    // One section, one heading. What the contribution currently is and what is
    // on offer belong together; two panels under the same title read as a bug.
    const planSummary = !plan.configured
      ? "Payments, receipts and cancellations all happen on our payment provider's own checkout, so this app never sees a card and never stores one."
      : plan.packages.length
        ? `From ${plan.packages[0].price || "—"} ${plan.packages[0].period}. Nothing is unlocked by this, because nothing needs unlocking. Cancel whenever you like without losing a feature.`
        : "No support options are published for this project yet, so there is nothing to offer here. The rest of the app is unaffected.";

    sections.push(
      panel({
        title: "CloudSlash Support",
        note: plan.configured && plan.packages.length ? `${num(plan.packages.length)} available` : undefined,
        body: [
          planFacts.length ? h("div", { class: "kv" }, ...planFacts) : null,
          plan.billingIssue
            ? note("warn", "The payment method needs attention", "The contribution is still active for now, but the card on file will need updating. Use Manage or cancel.")
            : null,
          !plan.configured ? note("warn", "Billing is not configured in this build", keyProblemMessage(plan.keyProblem)) : null,
          plan.error ? note("warn", "The plan could not be confirmed just now", plan.error) : null,
          h("p", { class: "t-small" }, planSummary),
          planActions,
        ],
      }),
    );

    /* -- what you get --------------------------------------------------- */
    sections.push(
      panel({
        title: "What you get",
        body: h(
          "div",
          { class: "panel__grid" },
          h(
            "div",
            {},
            h("span", { class: "t-stamp section-note" }, "On every machine, free"),
            includes([
              "Unlimited scans against your own account",
              "The full register, with cost, risk and ownership",
              "Topology and concentration",
              "Every artifact, remediation plans included",
              "Suppressed findings and retention tags",
              "No account, no key, nothing to activate",
            ]),
          ),
          h(
            "div",
            {},
            h("span", { class: "t-stamp section-note cat-note" }, icon("cat", 14, "cat-mark"), "As a supporter"),
            includes([
              "Nothing further is unlocked, because nothing is locked",
              "Your name on the supporters page, if you would like it",
              "Early builds of new engines and dashboards",
              "Nine lives, which is also the Lazarus Protocol",
            ]),
          ),
        ),
      }),
    );

    /* -- about ---------------------------------------------------------- */
    sections.push(
      panel({
        title: "About",
        quiet: true,
        body: h(
          "div",
          { class: "kv" },
          leaderRow("Version", profile?.Version ?? "dev", true),
          leaderRow("Licence", profile?.License ?? "—"),
          leaderRow("Analysis", "on this machine", true),
          leaderRow("Telemetry", "none by default", true),
        ),
      }),
    );

    inner.replaceChildren(...sections);
  }

  update();
  return { el, update };
}

/* ---------------------------------------------------------------------- */

function includes(items: string[]): HTMLElement {
  return h(
    "ul",
    { class: "includes" },
    ...items.map((item) => h("li", { class: "includes__item" }, item)),
  );
}
