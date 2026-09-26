// Fonts. Latin subsets only: the full families would triple the bundle for
// glyphs this interface never renders.
import "@fontsource/newsreader/latin-400.css";
import "@fontsource/newsreader/latin-500.css";
import "@fontsource/newsreader/latin-600.css";
import "@fontsource/instrument-sans/latin-400.css";
import "@fontsource/instrument-sans/latin-500.css";
import "@fontsource/instrument-sans/latin-600.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";

import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/views.css";

import { h } from "./lib/dom";
import { boot, state, subscribe, type ScreenID } from "./lib/state";
import { createBalance, createMasthead, createRail, createToast, screenIndex, screenLabel } from "./ui/shell";
import { dismissTip } from "./ui/charts";
import type { View } from "./ui/contracts";
import { createStatementView } from "./views/statement";
import { createRegisterView } from "./views/register";
import { createTopologyView } from "./views/topology";
import { createArtifactsView } from "./views/artifacts";
import { createAccountView } from "./views/account";
import { createSettingsView } from "./views/settings";

const FACTORIES: Record<ScreenID, () => View> = {
  statement: createStatementView,
  register: createRegisterView,
  topology: createTopologyView,
  artifacts: createArtifactsView,
  account: createAccountView,
  settings: createSettingsView,
};

const root = document.getElementById("app");
if (!root) throw new Error("#app is missing from index.html");

const masthead = createMasthead();
const rail = createRail();
const balance = createBalance();
const footer = createToast();

const work = h("div", { class: "work" });
const shell = h("div", { class: "shell" }, masthead.el, rail.el, work);

const bootNote = h(
  "div",
  { class: "boot" },
  h("span", { class: "boot__title" }, "CloudSlash"),
  h("span", { class: "boot__note" }, "Starting the analysis engine…"),
);

work.append(bootNote);
root.append(shell, footer.el);

/** Views are created on first visit and then kept, so scroll and selection survive. */
const views = new Map<ScreenID, View>();
let mounted = false;

function activeView(): View {
  let view = views.get(state.screen);
  if (!view) {
    view = FACTORIES[state.screen]();
    views.set(state.screen, view);
  }
  return view;
}

function render(): void {
  // State changes fire while boot() is still resolving; there is nothing to
  // render onto the page until the first profile arrives.
  if (!mounted) return;

  masthead.update();
  rail.update();
  balance.update();
  footer.update();

  const view = activeView();
  if (view.el.parentElement !== work) {
    for (const other of views.values()) {
      if (other !== view) other.el.remove();
    }
    work.append(view.el);

    // Any hover card belonged to the screen that just left.
    dismissTip();

    // Restart the arrival so a change of screen reads as a change of screen.
    // Removing the class and forcing a reflow is what re-triggers it.
    view.el.classList.remove("view--arrive");
    void view.el.offsetWidth;
    view.el.classList.add("view--arrive");
  }
  view.update();

  document.title = `CloudSlash: ${screenLabel(state.screen)}`;
  document.documentElement.dataset.screen = screenIndex(state.screen);
}

subscribe(render);

async function start(): Promise<void> {
  try {
    await boot();
  } catch (err) {
    // A failed boot still leaves a readable window rather than a blank canvas.
    bootNote.replaceChildren(
      h("span", { class: "boot__title" }, "CloudSlash could not start"),
      h("span", { class: "boot__note" }, String(err)),
    );
    return;
  }

  work.replaceChildren(balance.el, activeView().el);
  mounted = true;
  render();
}

void start();
