import { h } from "../lib/dom";
import { closePaywall, openExternal, refreshPlan, selectPlanPackage, state, toast } from "../lib/state";
import { environmentLabel, keyProblemMessage, purchasePlan, recheckPlan, managementTarget } from "../lib/billing";
import { REVENUECAT } from "../config/revenuecat";
import { LINKS } from "../lib/links";
import { button, note } from "./bits";
import { icon } from "./icons";
import type { Part } from "./contracts";

/**
 * The support dialog.
 *
 * One primary action; the restore path, the customer portal and the terms are
 * secondary to it.
 *
 * Being a modal, it behaves like one: focus moves in, Tab is trapped, Escape
 * closes, the page behind is inert, and focus returns to the element that opened
 * it.
 */

let previouslyFocused: HTMLElement | null = null;

export function createPaywall(): Part {
  const sheet = h("div", {
    class: "sheet",
    role: "dialog",
    "aria-modal": "true",
    "aria-labelledby": "paywall-title",
  });
  const backdrop = h("div", { class: "paywall", hidden: true, onclick: (event: Event) => {
    if (event.target === backdrop) closePaywall();
  } }, sheet);

  const el = backdrop;

  function focusables(): HTMLElement[] {
    return [...sheet.querySelectorAll<HTMLElement>("button, a[href], input, [tabindex]:not([tabindex='-1'])")].filter(
      (node) => !node.hasAttribute("disabled") && node.offsetParent !== null,
    );
  }

  function onKeydown(event: KeyboardEvent): void {
    if (!state.paywall.open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closePaywall();
      return;
    }
    if (event.key !== "Tab") return;

    const items = focusables();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement as HTMLElement | null;

    if (event.shiftKey && (active === first || !items.includes(active!))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  document.addEventListener("keydown", onKeydown);

  let lastOpen = false;

  function update(): void {
    const { paywall } = state;
    const wasOpen = lastOpen;
    lastOpen = paywall.open;

    if (paywall.open && !wasOpen) {
      previouslyFocused = document.activeElement as HTMLElement | null;
      // Take the rest of the interface out of the tab order while this is up.
      const shell = document.querySelector<HTMLElement>(".shell");
      if (shell) shell.inert = true;
      el.hidden = false;
    }

    if (!paywall.open) {
      if (wasOpen) {
        el.hidden = true;
        const shell = document.querySelector<HTMLElement>(".shell");
        if (shell) shell.inert = false;
        previouslyFocused?.focus?.();
      }
      return;
    }

    render(paywall.reason);

    // Move focus into the dialog once it has laid out, so a keyboard user lands
    // on the decision rather than back at the top of the page behind it.
    requestAnimationFrame(() => {
      const target =
        sheet.querySelector<HTMLElement>(".sheet__actions button") ?? sheet.querySelector<HTMLElement>("button");
      target?.focus();
    });
  }

  function render(reason: string): void {
    sheet.replaceChildren();

    const sandboxOn = plan_sandbox();

    sheet.append(
      h(
        "header",
        { class: "sheet__head" },
        h(
          "div",
          { class: "sheet__titles" },
          h("h2", { class: "sheet__title", id: "paywall-title" }, "CloudSlash Support"),
          h("p", { class: "sheet__reason" }, reason),
        ),
        sandboxOn ? h("span", { class: "tag tag--alarm" }, environmentLabel(state.plan.environment)) : null,
        button({ label: "Close", icon: "close", variant: "quiet", size: "sm", onClick: () => closePaywall() }),
      ),
    );

    const body = h("div", { class: "sheet__body" });
    sheet.append(body);

    /* -- what supporting does, ahead of the payment controls ----------- */
    body.append(
      h(
        "p",
        { class: "t-small" },
        "Every feature in CloudSlash is free, including the remediation plans and the dashboards. This is not a lock on any of it. It pays for the time it takes to keep the scanners working when AWS moves something, and that is the whole of what the money does.",
      ),
      h(
        "ul",
        { class: "includes" },
        ...[
          "Every feature, on every machine. Nothing is held back.",
          "Your name on the supporters page, if you would like it there.",
          "Early builds of new engines and dashboards.",
          "A cat's gratitude, which is famously hard to earn.",
        ].map((item) => h("li", { class: "includes__item" }, item)),
      ),
    );

    /* -- when the SDK cannot take the payment, still take the payment ---- */
    if (!state.plan.configured) {
      body.append(
        note("warn", "Plans cannot be listed in this build", keyProblemMessage(state.plan.keyProblem)),
        h(
          "div",
          { class: "row" },
          button({
            label: "Support CloudSlash",
            icon: "external",
            variant: "primary",
            onClick: () => void openExternal(REVENUECAT.supportUrl),
          }),
        ),
      );
      return;
    }

    /* -- the plans --------------------------------------------------- */
    if (state.plan.loading || state.plan.checking) {
      body.append(
        h(
          "div",
          { class: "stack" },
          h("span", { class: "skeleton", style: { width: "40%" } }),
          h("span", { class: "skeleton", style: { width: "62%" } }),
        ),
      );
      return;
    }

    if (!state.plan.packages.length) {
      body.append(
        note(
          "info",
          "No plans are published yet",
          "No support options are available yet, so there is nothing to choose here. Everything else in the app is unaffected.",
          button({ label: "Refresh", icon: "refresh", size: "sm", variant: "quiet", onClick: () => void refreshPlan() }),
        ),
      );
      return;
    }

    const selected = selectedPackageId();
    const group = h("div", { class: "plans", role: "radiogroup", "aria-label": "Choose a plan" });

    for (const pkg of state.plan.packages) {
      const input = h("input", {
        type: "radio",
        name: "plan",
        id: `plan-${pkg.id}`,
        checked: pkg.id === selected,
        onchange: () => selectPlanPackage(pkg.id),
      });
      group.append(
        h(
          "label",
          { class: `plan${pkg.id === selected ? " plan--on" : ""}`, for: `plan-${pkg.id}` },
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
    body.append(group);

    /* -- the decision ------------------------------------------------ */
    const busy = state.plan.purchasing;
    body.append(
      h(
        "div",
        { class: "sheet__actions" },
        button({
          label: busy ? "Opening checkout…" : "Support CloudSlash",
          icon: busy ? undefined : "arrow",
          variant: "primary",
          block: true,
          disabled: busy || !selected,
          onClick: () => {
            if (selected) buy(selected);
          },
        }),
        h(
          "p",
          { class: "sheet__fineprint" },
          "Payment and receipts are handled by our payment provider's own checkout, and no account is needed to give. Nothing here stops working if you cancel.",
        ),
      ),
    );

    if (state.plan.error) {
      body.append(note("err", "That did not complete", state.plan.error));
    }

    /* -- the secondary paths ---------------------------------------- */
    const secondary = h("div", { class: "sheet__secondary" });

    secondary.append(
      button({
        label: state.plan.checking ? "Checking…" : "Already subscribed? Check again",
        variant: "quiet",
        size: "sm",
        disabled: state.plan.checking,
        onClick: () => void restore(),
      }),
    );

    const manage = managementTarget();
    if (state.plan.pro && manage) {
      secondary.append(
        button({
          label: "Manage or cancel",
          icon: "external",
          variant: "quiet",
          size: "sm",
          onClick: () => {
            if (manage) void openExternal(manage);
          },
        }),
      );
    }

    body.append(
      secondary,
      h(
        "footer",
        { class: "sheet__foot" },
        h("span", { class: "t-meta" }, "CloudSlash is free, and stays free"),
        h(
          "span",
          { class: "row" },
          link("Terms", LINKS.terms),
          link("Privacy", LINKS.privacy),
          link("Support", LINKS.support),
        ),
      ),
    );
  }

  function plan_sandbox(): boolean {
    return state.plan.sandbox;
  }

  function link(label: string, url: string): HTMLElement {
    const el = h("button", { class: "btn btn--quiet btn--sm", type: "button" }, label, icon("external", 12, "btn__icon"));
    el.addEventListener("click", () => void openExternal(url));
    return el;
  }

  function selectedPackageId(): string | null {
    if (state.paywall.selected && state.plan.packages.some((p) => p.id === state.paywall.selected)) {
      return state.paywall.selected;
    }
    return state.plan.packages[0]?.id ?? null;
  }

  function buy(packageId: string): void {
    void (async () => {
      const outcome = await purchasePlan(packageId);
      switch (outcome.kind) {
        case "purchased":
          closePaywall();
          toast("success", "You are on Pro", "Remediation plans and the reporting artifacts are unlocked.");
          await refreshPlan();
          break;
        case "cancelled":
          break;
        case "pending":
          toast("info", "Payment is pending", outcome.message ?? "Access unlocks when the payment clears.");
          break;
        case "handoff":
          if (outcome.checkoutURL) {
            await openExternal(outcome.checkoutURL);
            toast(
              "info",
              "Finish in your browser",
              "Complete the checkout there, then come back and choose 'Already subscribed? Check again'.",
            );
          }
          break;
        default:
          toast("error", "The payment did not complete", outcome.message ?? "The payment provider returned an error.");
          break;
      }
    })();
  }

  async function restore(): Promise<void> {
    const next = await recheckPlan();
    if (next.pro) {
      closePaywall();
      toast("success", "Welcome back", "Your Pro entitlement is active on this account.");
    } else if (!next.error) {
      toast(
        "info",
        "No active entitlement found",
        "This install's account has no active Pro entitlement. If you subscribed with a different account, contact support and quote the reference on the Account screen.",
      );
    }
  }

  return { el, update };
}
