// Vite lib entry for the standalone, runtime-loadable bundle. Loading this file
// (e.g. `<script type="module" src="…/baobox-skill-builder.js">`) auto-registers
// the custom element so the host can drop `<baobox-skill-builder>` straight in.
import { registerSkillBuilder } from "./element.js";

registerSkillBuilder();
