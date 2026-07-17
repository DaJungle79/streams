import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import { CapturePanel } from "./views/Capture/CapturePanel";
import "./styles.css";

/**
 * Two windows, one bundle. The capture panel (SPEC §4.2) is its own webview so
 * the hotkey can summon it without the main window existing, and so it stays a
 * one-field surface rather than becoming a mode of the app.
 */
const isCapture = getCurrentWindow().label === "capture";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{isCapture ? <CapturePanel /> : <App />}</React.StrictMode>,
);
