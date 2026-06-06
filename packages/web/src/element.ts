import { h, render } from "preact";
import { SkillStudio } from "./SkillStudio.js";

export const DEFAULT_TAG = "baobox-skill-builder";

/**
 * `<baobox-skill-builder api-base="…" theme="light|dark">`
 *
 * A framework-agnostic custom element that renders the Skill Studio into its
 * own shadow root (style-isolated from the host). It reads ALL data from
 * `api-base` (the tenant BFF) via the #246 contract — it never talks to BaoBox
 * and carries no cookie/session.
 */
export class BaoBoxSkillBuilderElement extends HTMLElement {
  private root: ShadowRoot;

  static get observedAttributes(): string[] {
    return ["api-base", "theme"];
  }

  constructor() {
    super();
    this.root = this.attachShadow({ mode: "open" });
  }

  connectedCallback(): void {
    this.renderTree();
  }

  attributeChangedCallback(): void {
    if (this.isConnected) this.renderTree();
  }

  disconnectedCallback(): void {
    render(null, this.root);
  }

  private renderTree(): void {
    const apiBase = this.getAttribute("api-base") ?? "";
    const theme = this.getAttribute("theme") === "dark" ? "dark" : "light";
    render(h(SkillStudio, { apiBase, theme }), this.root);
  }
}

/** Register the custom element (idempotent). Returns the tag name. */
export function registerSkillBuilder(tag: string = DEFAULT_TAG): string {
  if (typeof customElements !== "undefined" && !customElements.get(tag)) {
    customElements.define(tag, BaoBoxSkillBuilderElement);
  }
  return tag;
}
