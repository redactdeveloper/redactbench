import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";
import "@fontsource/roboto-condensed/latin-400.css";
import "@fontsource/roboto-condensed/latin-600.css";
import "@fontsource/roboto-condensed/latin-700.css";

import { Dashboard } from "./App.js";
import "./styles.css";

const root = document.querySelector<HTMLDivElement>("#root");

if (!root) {
  throw new Error("Dashboard root element is missing");
}

createRoot(root).render(
  <StrictMode>
    <Dashboard />
  </StrictMode>
);
