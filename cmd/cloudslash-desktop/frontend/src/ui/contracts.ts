/**
 * The two DOM contracts the interface is built from.
 *
 * A `Part` is a piece of persistent chrome that updates itself in place.
 * A `View` is a screen: its own element, plus an `update` the shell calls when
 * state changes.
 *
 * Both exist so that a re-render never destroys focused controls. Rebuilding
 * the whole DOM on every poll is how a desktop app ends up dropping keystrokes
 * in a search box, and this interface polls while a scan runs.
 */

export interface Part {
  el: HTMLElement;
  update(): void;
}

export interface View {
  el: HTMLElement;
  /** Called on every state change; must be safe to call often. */
  update(): void;
}
