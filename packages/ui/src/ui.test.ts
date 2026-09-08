import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppShell, Button, Input } from "./index";
describe("shared UI foundation", () => {
  it("renders typed accessible controls", () => { const html = renderToStaticMarkup(createElement("div", null, createElement(Button, null, "Save"), createElement(Input, { label: "Medicine", name: "medicine" }))); expect(html).toContain("ml-button"); expect(html).toContain("Medicine"); expect(html).toContain('name="medicine"'); });
  it("renders a shared, persona-themed application shell with skip navigation", () => { const html = renderToStaticMarkup(createElement(AppShell, { brand: "MedLink", persona: "pharmacist", currentPath: "/pharmacist", navigation: [{ label: "Clinical Queue", href: "/pharmacist" }] }, "Workspace")); expect(html).toContain("Skip to content"); expect(html).toContain("Workspace"); expect(html).toContain("Clinical Queue"); expect(html).toContain('data-persona="pharmacist"'); expect(html).toContain('aria-current="page"'); expect(html).toContain("--persona-primary:#075985"); });
  it("marks only the most specific authorized navigation item active", () => { const html = renderToStaticMarkup(createElement(AppShell, { brand: "MedLink", persona: "admin", currentPath: "/admin/catalog", navigation: [{ label: "Overview", href: "/admin" }, { label: "Catalog", href: "/admin/catalog" }] }, "Catalog")); expect(html.match(/aria-current="page"/g)).toHaveLength(1); expect(html).toContain('<a aria-current="page" href="/admin/catalog">Catalog</a>'); });
});
