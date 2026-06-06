// Dev harness: mount <baobox-skill-builder> against the in-memory mock BFF, so
// the element runs with NO live backend (the VITE_MOCK_API idea). Run `npm run
// dev` in this package.
import { registerSkillBuilder } from "../src/element.js";
import { createMockFetch } from "./mock-bff.js";

// Route the element's fetches to the mock. The element uses the global fetch,
// so we patch it here in the harness only.
const mock = createMockFetch({ latencyMs: 250 });
const realFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input.toString();
  return url.includes("/api/skill-studio") ? mock(input, init) : realFetch(input, init);
}) as typeof globalThis.fetch;

registerSkillBuilder();

const app = document.getElementById("app");
if (app) {
  app.innerHTML = `<baobox-skill-builder api-base="/api/skill-studio" theme="light"></baobox-skill-builder>`;
}
