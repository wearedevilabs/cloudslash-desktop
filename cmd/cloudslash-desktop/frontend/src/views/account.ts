import { h } from "../lib/dom";
import { openExternal, purchaseSelectedPlan, refreshPlan, selectPlanPackage, selectedPlanId, state } from "../lib/state";
import { environmentLabel, keyProblemMessage, managementTarget } from "../lib/billing";
import { REVENUECAT } from "../config/revenuecat";
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

  /**
   * The plans, on the page rather than behind a button. The radio group is named
   * apart from the dialog's so the two cannot fight over one selection.
   */
  function planChooser(): Node {
    const selected = selectedPlanId();
    const group = h("div", { class: "plans plans--inline", role: "radiogroup", "aria-label": "Choose a support plan" });

    for (const pkg of state.plan.packages) {
      const input = h("input", {
        type: "radio",
        name: "account-plan",
        id: `account-plan-${pkg.id}`,
        checked: pkg.id === selected,
        onchange: () => selectPlanPackage(pkg.id),
      });

      group.append(
        h(
          "label",
          { class: `plan${pkg.id === selected ? " plan--on" : ""}`, for: `account-plan-${pkg.id}` },
          input,
          h(
            "span",
            { class: "plan__text" },
            h("span", { class: "plan__title" }, pkg.title),
            pkg.description ? h("span", { class: "plan__note" }, pkg.description) : null,
          ),
          h(
            "span",
            { class: "plan__price" },
            h("span", { class: "t-figure plan__amount" }, pkg.price || "—"),
            h("span", { class: "plan__period" }, pkg.period),
          ),
        ),
      );
    }

    return group;
  }

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

    const planActions = h("div", { class: "row-actions row-actions--after" });

    if (plan.loading || plan.checking) {
      planActions.append(h("span", { class: "t-small is-muted" }, plan.checking ? "Checking your plan…" : "Loading…"));
    } else if (!plan.configured) {
      // Nothing can be listed, so the only honest action is the hosted page.
      planActions.append(
        button({
          label: "Support CloudSlash",
          icon: "external",
          variant: "primary",
          onClick: () => void openExternal(REVENUECAT.supportUrl),
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
      // The plans are already on screen, so this buys the chosen one rather than
      // opening a second place that shows the same thing.
      planActions.append(
        button({
          label: state.plan.purchasing ? "Opening checkout…" : "Support CloudSlash",
          icon: state.plan.purchasing ? undefined : "arrow",
          variant: "primary",
          disabled: state.plan.purchasing,
          onClick: () => void purchaseSelectedPlan(),
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
      // Configured, but nothing published: there is nothing to buy, so the only
      // useful action is to look again.
      planActions.append(
        button({ label: "Refresh", icon: "refresh", variant: "quiet", onClick: () => void refreshPlan() }),
      );
    }

    // One section, one heading. What the contribution currently is and what is
    // on offer belong together; two panels under the same title read as a bug.
    const hasPlans = plan.configured && plan.packages.length > 0;

    const planSummary = !plan.configured
      ? "Payments, receipts and cancellations all happen on our payment provider's own checkout, so this app never sees a card and never stores one."
      : hasPlans
        ? "Nothing is unlocked by this, because nothing needs unlocking. Cancel whenever you like without losing a feature."
        : "No support options are published for this project yet, so there is nothing to offer here. The rest of the app is unaffected.";

    sections.push(
      panel({
        title: "CloudSlash Support",
        note: hasPlans ? `${num(plan.packages.length)} available` : undefined,
        body: [
          planFacts.length ? h("div", { class: "kv" }, ...planFacts) : null,
          plan.billingIssue
            ? note("warn", "The payment method needs attention", "The contribution is still active for now, but the card on file will need updating. Use Manage or cancel.")
            : null,
          !plan.configured ? note("warn", "Billing is not configured in this build", keyProblemMessage(plan.keyProblem)) : null,
          plan.error ? note("warn", "The plan could not be confirmed just now", plan.error) : null,
          hasPlans ? planChooser() : null,
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
