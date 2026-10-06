import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import AvatarPreview from "./components/AvatarPreview";
import "./styles.css";
import "./avatar2d.css";
import "./showcase.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {new URLSearchParams(window.location.search).has("avatar-preview") ? <AvatarPreview /> : <App />}
  </StrictMode>,
);
