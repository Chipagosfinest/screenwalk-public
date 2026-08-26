import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "./styles.css";

const App = lazy(() => import("./App.tsx").then((module) => ({ default: module.App })));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Suspense fallback={<main className="load-state"><span />Loading Screenwalk Studio…</main>}>
      <App />
    </Suspense>
  </StrictMode>,
);
