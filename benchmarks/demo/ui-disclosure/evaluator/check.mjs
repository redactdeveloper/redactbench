import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const scenario = process.argv[2];
const html = await readFile("/workspace/index.html", "utf8");

function openingTag(id) {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return html.match(
    new RegExp(`<([a-z][\\w-]*)\\b[^>]*\\bid=["']${escaped}["'][^>]*>`, "iu")
  )?.[0] ?? null;
}

function attribute(tag, name) {
  return tag?.match(
    new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "iu")
  )?.[1] ?? null;
}

const toggleTag = openingTag("details-toggle");
const panelTag = openingTag("details-panel");

async function interactionWorks() {
  if (!toggleTag || !panelTag) return false;
  const listeners = new Map();
  const attributes = new Map([
    ["aria-controls", attribute(toggleTag, "aria-controls")],
    ["aria-expanded", attribute(toggleTag, "aria-expanded")]
  ]);
  const toggle = {
    onclick: null,
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    getAttribute(name) {
      return attributes.get(name) ?? null;
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    }
  };
  const panel = {
    hidden: /\shidden(?:\s|=|>)/iu.test(panelTag)
  };
  const document = {
    getElementById(id) {
      return id === "details-toggle" ? toggle : id === "details-panel" ? panel : null;
    },
    querySelector(selector) {
      return selector === "#details-toggle"
        ? toggle
        : selector === "#details-panel"
          ? panel
          : null;
    }
  };
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/giu)]
    .map((match) => match[1])
    .join("\n");
  runInNewContext(scripts, { document });
  const click = listeners.get("click") ?? toggle.onclick;
  if (typeof click !== "function") return false;
  click({ currentTarget: toggle });
  const opened = panel.hidden === false && toggle.getAttribute("aria-expanded") === "true";
  click({ currentTarget: toggle });
  return opened && panel.hidden === true && toggle.getAttribute("aria-expanded") === "false";
}

const checks = {
  semantic:
    toggleTag?.startsWith("<button") === true &&
    attribute(toggleTag, "type") === "button",
  state:
    attribute(toggleTag, "aria-controls") === "details-panel" &&
    attribute(toggleTag, "aria-expanded") === "false" &&
    /\shidden(?:\s|=|>)/iu.test(panelTag ?? ""),
  behavior: await interactionWorks(),
  hygiene: !/\sonclick\s*=/iu.test(html)
};

if (!scenario || !(scenario in checks) || !checks[scenario]) {
  console.error(`UI scenario failed: ${scenario ?? "missing"}`);
  process.exit(1);
}
