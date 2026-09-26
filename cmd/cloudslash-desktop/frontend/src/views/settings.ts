import { h } from "../lib/dom";
import { openExternal, chooseDirectory, openOutputDir, savePrefs, state } from "../lib/state";
import { LINKS } from "../lib/links";
import { button, note, panel } from "../ui/bits";
import type { View } from "../ui/contracts";
import type { Prefs } from "../lib/types";

/**
 * Settings: the engine's configuration surface.
 *
 * These map one-to-one onto `engine.Config`, so a scan started from the window
 * behaves like `cloudslash scan` with the same flags.
 *
 * The form is built once and only its values are synced afterwards. Rebuilding
 * it on every state change would drop focus mid-word, and this window polls
 * while a scan runs.
 */

type Kind = "text" | "number" | "switch" | "secret";

interface FieldSpec {
  key: keyof Prefs;
  label: string;
  kind: Kind;
  hint?: string;
  placeholder?: string;
  step?: string;
  min?: number;
  max?: number;
  /** Title for the native folder picker, when this field names a path. */
  choose?: string;
}

interface Group {
  title: string;
  note?: string;
  fields: FieldSpec[];
}

const GROUPS: Group[] = [
  {
    title: "Scope",
    note: "what gets read",
    fields: [
      {
        key: "Region",
        label: "AWS region",
        kind: "text",
        placeholder: "us-east-1",
        hint: "The region the scan starts from. Individual scanners still cover the services you have there.",
      },
      {
        key: "AllProfiles",
        label: "Scan every AWS profile",
        kind: "switch",
        hint: "Fans out across every profile in your credential chain, not just the default one.",
      },
      {
        key: "TFStatePath",
        label: "Terraform state path",
        kind: "text",
        placeholder: "/path/to/terraform.tfstate",
        hint: "Correlate live resources with the code that created them.",
        choose: "Choose the Terraform state file",
      },
    ],
  },
  {
    title: "Analysis",
    note: "how hard it looks",
    fields: [
      {
        key: "DisableCWMetrics",
        label: "Skip CloudWatch metrics",
        kind: "switch",
        hint: "Much faster, less certain: idleness is judged from configuration and topology alone.",
      },
      {
        key: "MaxConcurrency",
        label: "Parallel workers",
        kind: "number",
        min: 1,
        max: 500,
        hint: "How many scanners run at once. Higher is faster and more likely to be throttled.",
      },
      {
        key: "DiscountRate",
        label: "Effective discount rate",
        kind: "number",
        min: 0,
        max: 1,
        step: "0.01",
        hint: "Your real rate after EDP or reserved instances, as a fraction. 0 means list pricing.",
      },
      {
        key: "StrictMode",
        label: "Strict mode",
        kind: "switch",
        hint: "Treat a partial scan as a failure instead of reporting what it managed to read.",
      },
    ],
  },
  {
    title: "Governance",
    note: "your rules",
    fields: [
      {
        key: "RulesFile",
        label: "Policy rules file",
        kind: "text",
        placeholder: "rules.yaml",
        hint: "A YAML file of CEL policies, run against the live graph on top of the built-in heuristics.",
      },
      {
        key: "RequiredTags",
        label: "Required tags",
        kind: "text",
        placeholder: "owner,env,cost-centre",
        hint: "Comma-separated tag keys. Resources missing them are flagged for attribution.",
      },
    ],
  },
  {
    title: "Cost history",
    fields: [
      {
        key: "HistoryURL",
        label: "History location",
        kind: "text",
        placeholder: "s3://bucket/cloudslash/history",
        hint: "Where the ledger of past scans lives. S3 survives ephemeral runners; empty keeps it local.",
      },
    ],
  },
  {
    title: "Notifications",
    note: "optional",
    fields: [
      {
        key: "SlackWebhook",
        label: "Slack webhook",
        kind: "secret",
        placeholder: "https://hooks.slack.com/services/…",
        hint: "Posts a waste summary and any velocity alerts. Stored locally; sent only to Slack.",
      },
      {
        key: "SlackChannel",
        label: "Slack channel override",
        kind: "text",
        placeholder: "#cloud-cost",
        hint: "Used when the webhook targets a workspace rather than a single channel.",
      },
    ],
  },
  {
    title: "Telemetry",
    note: "off unless you say otherwise",
    fields: [
      {
        key: "OtelEndpoint",
        label: "OpenTelemetry endpoint",
        kind: "text",
        placeholder: "http://localhost:4318",
        hint: "Traces and metrics go here over OTLP/HTTP. Empty means nothing leaves this machine.",
      },
    ],
  },
  {
    title: "Output",
    fields: [
      {
        key: "OutputDir",
        label: "Artifact directory",
        kind: "text",
        placeholder: "~/Documents/CloudSlash",
        hint: "Reports, remediation scripts and tombstones are written here. Accepts an s3:// location.",
        choose: "Choose the artifact folder",
      },
    ],
  },
];

export function createSettingsView(): View {
  const el = h("div", { class: "view" });
  const inner = h("div", { class: "view__inner" });
  el.append(inner);

  const controls = new Map<keyof Prefs, HTMLInputElement>();

  function control(spec: FieldSpec): HTMLInputElement {
    if (spec.kind === "switch") {
      const input = h("input", { type: "checkbox", id: `pref-${spec.key}`, checked: Boolean(state.prefs[spec.key]) });
      input.addEventListener("change", () => void savePrefs({ [spec.key]: input.checked } as Partial<Prefs>));
      controls.set(spec.key, input);
      return input;
    }

    const input = h("input", {
      id: `pref-${spec.key}`,
      class: "input",
      type: spec.kind === "number" ? "number" : spec.kind === "secret" ? "password" : "text",
      value: String(state.prefs[spec.key] ?? ""),
      placeholder: spec.placeholder ?? "",
      autocomplete: "off",
      spellcheck: "false",
    });
    if (spec.step) input.setAttribute("step", spec.step);
    if (spec.min !== undefined) input.setAttribute("min", String(spec.min));
    if (spec.max !== undefined) input.setAttribute("max", String(spec.max));

    const commit = () => {
      if (spec.kind === "number") {
        const raw = Number(input.value);
        const bounded = Number.isFinite(raw)
          ? Math.min(spec.max ?? Number.POSITIVE_INFINITY, Math.max(spec.min ?? Number.NEGATIVE_INFINITY, raw))
          : 0;
        void savePrefs({ [spec.key]: bounded } as Partial<Prefs>);
        return;
      }
      void savePrefs({ [spec.key]: input.value.trim() } as Partial<Prefs>);
    };

    input.addEventListener("change", commit);
    input.addEventListener("blur", commit);

    controls.set(spec.key, input);
    return input;
  }

  function render(): void {
    const { profile, mode } = state;

    const sections: Node[] = [
      h("div", { class: "view__title" }, h("h1", {}, "Settings"), h("span", { class: "t-stamp" }, "engine config")),
      h(
        "p",
        { class: "view__lede" },
        "Exactly the inputs the command line accepts. Changes apply to the next scan and are remembered between launches.",
      ),
    ];

    for (const group of GROUPS) {
      const rows = group.fields.map((spec) => {
        const input = control(spec);

        if (spec.kind === "switch") {
          return h(
            "label",
            { class: "setting setting--switch", for: `pref-${spec.key}` },
            h(
              "span",
              { class: "setting__text" },
              h("span", { class: "setting__label" }, spec.label),
              spec.hint ? h("span", { class: "setting__hint" }, spec.hint) : null,
            ),
            h("span", { class: "switch" }, input, h("span", { class: "switch__track" }, h("span", { class: "switch__knob" }))),
          );
        }

        return h(
          "div",
          { class: "setting" },
          h(
            "label",
            { class: "setting__text", for: `pref-${spec.key}` },
            h("span", { class: "setting__label" }, spec.label),
            spec.hint ? h("span", { class: "setting__hint" }, spec.hint) : null,
          ),
          h(
            "div",
            { class: "row" },
            input,
            spec.choose
              ? button({
                  label: "Choose…",
                  icon: "folder",
                  variant: "quiet",
                  size: "sm",
                  onClick: () =>
                    void chooseDirectory(spec.choose as string, String(state.prefs[spec.key] ?? ""), async (path) => {
                      input.value = path;
                      await savePrefs({ [spec.key]: path } as Partial<Prefs>);
                    }),
                })
              : null,
          ),
        );
      });

      sections.push(panel({ title: group.title, note: group.note, body: h("div", { class: "settings" }, ...rows) }));
    }

    sections.push(
      note(
        "info",
        "Where this is kept",
        profile
          ? `Preferences live with the rest of your local state in ${profile.DataDir}. Analysis is local-first: none of this is uploaded.`
          : "Preferences are stored locally.",
        h(
          "div",
          { class: "row" },
          button({ label: "Artifacts folder", icon: "folder", size: "sm", variant: "quiet", onClick: () => void openOutputDir() }),
          button({
            label: "Configuration reference",
            icon: "external",
            size: "sm",
            variant: "quiet",
            onClick: () => void openExternal(LINKS.docs),
          }),
        ),
      ),
    );

    if (mode === "preview") {
      sections.push(
        note(
          "warn",
          "Preview data",
          "This window is running on synthetic data because the Go service did not answer, so nothing changed here is being written to a real profile.",
        ),
      );
    }

    inner.replaceChildren(...sections);
  }

  /** Sync values only. Never rebuild, so focus survives a poll. */
  function update(): void {
    for (const [key, input] of controls) {
      if (document.activeElement === input) continue;
      const current = state.prefs[key];
      if (input.type === "checkbox") input.checked = Boolean(current);
      else input.value = String(current ?? "");
    }
  }

  render();
  return { el, update };
}
