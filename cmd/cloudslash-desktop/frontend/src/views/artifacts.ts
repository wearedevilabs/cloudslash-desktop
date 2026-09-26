import { h } from "../lib/dom";
import {
  askRemediation,
  cancelRemediation,
  chooseDirectory,
  exportAll,
  exportArtifact,
  openArtifact,
  openExternal,
  openOutputDir,
  refreshArtifacts,
  runRemediation,
  savePrefs,
  state,
} from "../lib/state";
import { LINKS } from "../lib/links";
import { humanBytes, num, relTime } from "../lib/format";
import { button, emptyState, note, panel } from "../ui/bits";
import type { View } from "../ui/contracts";

/**
 * The generated scripts the interface can run itself, and what each one does.
 *
 * The point of listing them as actions rather than files is that the order they
 * have to be run in stops being the operator's problem: freeze, then restore, both
 * from here, with the output on screen.
 */
const RUNNABLE: Record<string, { label: string; does: string }> = {
  "safe_cleanup.sh": {
    label: "Freeze resources",
    does: "Snapshots, stops and detaches the flagged resources. Data is kept; the billing stops.",
  },
  "undo_cleanup.sh": {
    label: "Restore resources",
    does: "Starts the frozen resources and re-attaches their volumes from the tombstones.",
  },
};

/**
 * Artifacts: what the scan can produce, and what it has already written.
 *
 * Also states the order the remediation artifacts are meant to be run in, since
 * the generated scripts are destructive.
 */
export function createArtifactsView(): View {
  const el = h("div", { class: "view" });
  const inner = h("div", { class: "view__inner" });
  el.append(inner);

  /** The two-press control for a generated script, shared by the bar and the list. */
  function remediationAction(name: string): Node {
    const info = RUNNABLE[name];
    const pending = state.remediation.script === name;

    if (pending && state.remediation.stage === "confirm") {
      return h(
        "div",
        { class: "confirm" },
        h("span", { class: "confirm__label" }, "Run it now?"),
        button({ label: "Cancel", variant: "quiet", size: "sm", onClick: () => cancelRemediation() }),
        button({ label: "Run it", size: "sm", onClick: () => void runRemediation() }),
      );
    }
    if (pending) {
      return h("span", { class: "confirm__label" }, "Running…");
    }
    return button({ label: info.label, icon: "play", size: "sm", onClick: () => askRemediation(name) });
  }

  /** The file bar: where artifacts go, and everything that acts on them. */
  function fileToolbar(scanned: boolean, present: Set<string>): Node {
    const folder = state.profile?.OutputDir ?? "";
    const scripts = Object.keys(RUNNABLE).filter((name) => present.has(name));

    return h(
      "div",
      { class: "toolbar toolbar--file" },
      h(
        "div",
        { class: "toolbar__path" },
        h("span", { class: "fact__k" }, "folder"),
        h("span", { class: "toolbar__dir t-figure", title: folder }, folder || "not set"),
      ),
      h(
        "div",
        { class: "row" },
        button({
          label: "Choose…",
          icon: "folder",
          variant: "quiet",
          size: "sm",
          onClick: () => void chooseDirectory("Choose the artifact folder", folder, (path) => savePrefs({ OutputDir: path })),
        }),
        button({ label: "Show folder", icon: "external", variant: "quiet", size: "sm", onClick: () => void openOutputDir() }),
        button({ label: "Refresh", icon: "refresh", variant: "quiet", size: "sm", onClick: () => void refreshArtifacts() }),
        button({
          label: state.exporting ? "Writing…" : "Generate all",
          icon: "download",
          size: "sm",
          disabled: !scanned || Boolean(state.exporting),
          onClick: () => void exportAll(),
        }),
        ...scripts.map((name) => remediationAction(name)),
      ),
    );
  }

  function update(): void {
    const { snapshot, artifacts, exports } = state;
    const scanned = snapshot.Status === "complete";
    const present = new Set(artifacts.map((artifact) => artifact.Name));

    const sections: Node[] = [
      h("div", { class: "view__title" }, h("h1", {}, "Artifacts"), h("span", { class: "t-stamp" }, "on disk")),
      h(
        "p",
        { class: "view__lede" },
        "Reports and remediation artifacts, written locally. Nothing is uploaded, and nothing is deleted without a script you run yourself.",
      ),
      fileToolbar(scanned, present),
    ];

    /* -- generate ------------------------------------------------------ */
    // Every artifact is free; none is gated.

    const rows = exports.map((spec) => {
      const exists = present.has(spec.FileName);

      const actions = h(
        "div",
        { class: "row" },
        button({
          label: state.exporting === spec.Kind ? "Writing…" : exists ? "Regenerate" : "Generate",
          icon: "download",
          variant: "quiet",
          size: "sm",
          disabled: !scanned || state.exporting === spec.Kind,
          onClick: () => void exportArtifact(spec.Kind),
        }),
        // Offer the file as soon as it exists, so an artifact written on an
        // earlier run is one press away rather than a trip to the list below.
        exists
          ? button({
              label: "Open",
              icon: "external",
              variant: "quiet",
              size: "sm",
              onClick: () => void openArtifact(spec.FileName),
            })
          : null,
      );

      return h(
        "div",
        { class: `list-row${scanned ? "" : " list-row--waiting"}` },
        h(
          "div",
          { class: "list-row__main" },
          h(
            "span",
            { class: "list-row__name" },
            spec.Label,
            h("span", { class: "list-row__file t-figure" }, spec.FileName),
          ),
          h("span", { class: "list-row__note" }, spec.Description),
        ),
        actions,
      );
    });

    sections.push(
      panel({
        title: "Generate",
        note: scanned ? `${num(exports.length)} available` : "waiting for a scan",
        body: rows.length
          ? h("div", { class: "list" }, ...rows)
          : h("p", { class: "t-small" }, "No exporters are registered in this build."),
      }),
    );

    /* -- already written ----------------------------------------------- */
    // The two generated scripts are actions, not files to go and run yourself.
    // Everything else is opened.
    const disk = artifacts.length
      ? h(
          "div",
          { class: "list" },
          ...artifacts.map((artifact) => {
            const runnable = RUNNABLE[artifact.Name];

            const action: Node = runnable
              ? remediationAction(artifact.Name)
              : button({
                  label: "Open",
                  icon: "external",
                  variant: "quiet",
                  size: "sm",
                  onClick: () => void openArtifact(artifact.Name),
                });

            return h(
              "div",
              { class: "list-row" },
              h(
                "div",
                { class: "list-row__main" },
                h("span", { class: "list-row__name" }, artifact.Name),
                h(
                  "span",
                  { class: "list-row__note" },
                  runnable
                    ? runnable.does
                    : `${humanBytes(artifact.Size)} · updated ${relTime(artifact.ModTime)}`,
                ),
              ),
              action,
            );
          }),
        )
      : emptyState(
          "Nothing written yet",
          scanned
            ? "Generate any of the artifacts above and it will be listed here, ready to open or run."
            : "Run a scan first, then generate the report you need.",
        );

    sections.push(
      panel({
        title: "On disk",
        note: artifacts.length ? `${num(artifacts.length)} files` : undefined,
        body: disk,
      }),
    );

    if (snapshot.Partial) {
      sections.push(
        note(
          "warn",
          "The last scan had gaps",
          "Some scopes could not be read, so these artifacts describe a partial account. Do not treat the plan as exhaustive until a full scan completes.",
        ),
      );
    }

    /* -- what the last run said ---------------------------------------- */
    const result = state.remediationResult;
    if (result) {
      sections.push(
        panel({
          title: `Output: ${result.Script}`,
          note:
            result.Error || result.ExitCode !== 0
              ? `exit ${result.ExitCode}`
              : `finished in ${(result.DurationMS / 1000).toFixed(1)}s`,
          body: h(
            "pre",
            { class: "output" },
            result.Output || result.Error || "The script printed nothing.",
          ),
        }),
      );
    }

    sections.push(
      h(
        "div",
        { class: "row" },
        button({
          label: "How remediation works",
          icon: "external",
          variant: "quiet",
          size: "sm",
          onClick: () => void openExternal(LINKS.docs),
        }),
        button({
          label: "Something looks wrong",
          icon: "external",
          variant: "quiet",
          size: "sm",
          onClick: () => void openExternal(LINKS.feedback),
        }),
      ),
    );

    inner.replaceChildren(...sections);
  }

  update();
  return { el, update };
}
