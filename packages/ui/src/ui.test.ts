import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppShell, Button, Input } from "./index";
describe("shared UI foundation", () => {
  it("renders typed accessible controls", () => { const html = renderToStaticMarkup(createElement("div", null, createElement(Button, null, "Save"), createElement(Input, { label: "Medicine", name: "medicine" }))); expect(html).toContain("ml-button"); expect(html).toContain("Medicine"); expect(html).toContain('name="medicine"'); });
  it("renders a shared, persona-themed application shell with skip navigation", () => { const html = renderToStaticMarkup(createElement(AppShell, { brand: "MedLink", persona: "pharmacist", navigation: [{ label: "Clinical Queue", href: "/pharmacist" }] }, "Workspace")); expect(html).toContain("Skip to content"); expect(html).toContain("Workspace"); expect(html).toContain("Clinical Queue"); expect(html).toContain('data-persona="pharmacist"'); });
});
