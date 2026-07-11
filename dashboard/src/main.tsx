import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./styles.css";

function App() {
  return <main>RedactBench dashboard is initialized.</main>;
}

const root = document.querySelector<HTMLDivElement>("#root");

if (!root) {
  throw new Error("Dashboard root element is missing");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
