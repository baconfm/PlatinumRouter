import { bindThemePickers, bootstrapTheme } from "./theme-manager.js";

bootstrapTheme();

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    bindThemePickers(document);
  }, { once: true });
} else {
  bindThemePickers(document);
}
