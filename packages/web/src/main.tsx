import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <div className="app-version" aria-hidden="true">
      v{__APP_VERSION__}
    </div>
  </StrictMode>,
);
