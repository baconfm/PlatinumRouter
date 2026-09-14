export const THEME_STORAGE_KEY = "platinum-router-theme";

export const THEMES = [
  { id: "classic", label: "Classic" },
  { id: "earth", label: "Earth" }
];

const VALID_THEME_IDS = new Set(THEMES.map((theme) => theme.id));
let listenersBound = false;

function isValidTheme(themeId) {
  return VALID_THEME_IDS.has(String(themeId || "").trim());
}

export function readStoredTheme() {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return isValidTheme(stored) ? stored : "";
  } catch {
    return "";
  }
}

export function readQueryTheme(url = window.location.href) {
  try {
    const requested = new URL(url).searchParams.get("theme");
    return isValidTheme(requested) ? requested : "";
  } catch {
    return "";
  }
}

export function resolveTheme(themeId = "") {
  if (isValidTheme(themeId)) return themeId;

  const queryTheme = readQueryTheme();
  if (queryTheme) return queryTheme;

  return readStoredTheme() || "classic";
}

function syncThemePickers(root = document, themeId = resolveTheme()) {
  root.querySelectorAll("[data-theme-picker]").forEach((picker) => {
    if (!(picker instanceof HTMLSelectElement)) return;

    if (!picker.dataset.themeOptionsBound) {
      picker.innerHTML = THEMES.map(
        (theme) => `<option value="${theme.id}">${theme.label}</option>`
      ).join("");
      picker.dataset.themeOptionsBound = "1";
    }

    if (picker.value !== themeId) {
      picker.value = themeId;
    }
  });
}

export function applyTheme(themeId = "", { persist = true, emit = true } = {}) {
  const nextTheme = resolveTheme(themeId);

  document.documentElement.dataset.theme = nextTheme;
  document.documentElement.style.colorScheme = "dark";
  syncThemePickers(document, nextTheme);

  if (persist) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // Ignore storage failures and keep the page usable.
    }
  }

  if (emit) {
    window.dispatchEvent(
      new CustomEvent("platinum-router-themechange", {
        detail: { theme: nextTheme }
      })
    );
  }

  return nextTheme;
}

function bindGlobalThemeListeners() {
  if (listenersBound) return;
  listenersBound = true;

  window.addEventListener("storage", (event) => {
    if (event.key !== THEME_STORAGE_KEY) return;

    applyTheme(event.newValue || "classic", {
      persist: false,
      emit: false
    });
  });
}

export function bindThemePickers(root = document) {
  syncThemePickers(root, resolveTheme());

  root.querySelectorAll("[data-theme-picker]").forEach((picker) => {
    if (!(picker instanceof HTMLSelectElement)) return;
    if (picker.dataset.themeBound === "1") return;

    picker.dataset.themeBound = "1";
    picker.addEventListener("change", () => {
      applyTheme(picker.value, { persist: true, emit: true });
    });
  });
}

export function bootstrapTheme() {
  bindGlobalThemeListeners();

  const queryTheme = readQueryTheme();
  applyTheme(queryTheme || readStoredTheme() || "classic", {
    persist: false,
    emit: false
  });
}
