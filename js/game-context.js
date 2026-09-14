import { loadGameMeta, loadGamesManifest } from "./data-loader.js?v=20260712f";
import {
  FALLBACK_GAME_ID,
  GAME_ID_QUERY_PARAM,
  ROUTE_ID_QUERY_PARAM,
  sanitizeGameId,
  sanitizeRouteId,
  writeStoredGameId,
  readStoredGameId,
  writeStoredRouteId,
  readStoredRouteId
} from "./game-session.js";

function isNavigableHref(href) {
  return typeof href === "string" && href.trim() && !href.startsWith("#") && !href.startsWith("mailto:");
}

export function readGameIdFromLocation() {
  try {
    const url = new URL(window.location.href);
    return sanitizeGameId(url.searchParams.get(GAME_ID_QUERY_PARAM));
  } catch {
    return "";
  }
}

export function readRouteIdFromLocation() {
  try {
    const url = new URL(window.location.href);
    return sanitizeRouteId(url.searchParams.get(ROUTE_ID_QUERY_PARAM));
  } catch {
    return "";
  }
}

export function buildGameHref(href, gameId, routeId = "") {
  if (!isNavigableHref(href)) return href;

  const url = new URL(href, window.location.href);

  if (!url.pathname.endsWith(".html")) {
    return href;
  }

  url.searchParams.set(GAME_ID_QUERY_PARAM, gameId);
  const nextRouteId = sanitizeRouteId(routeId);
  if (nextRouteId) {
    url.searchParams.set(ROUTE_ID_QUERY_PARAM, nextRouteId);
  } else {
    url.searchParams.delete(ROUTE_ID_QUERY_PARAM);
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

export function updateGameLinks(gameId, routeId = "", root = document) {
  root.querySelectorAll("a[href]").forEach((link) => {
    const href = link.getAttribute("href");
    if (!isNavigableHref(href)) return;

    const nextHref = buildGameHref(href, gameId, routeId);
    if (nextHref) {
      link.setAttribute("href", nextHref);
    }
  });
}

export function syncGameContextInUrl(gameId, routeId = "") {
  const nextGameId = sanitizeGameId(gameId);
  if (!nextGameId) return;

  try {
    const url = new URL(window.location.href);
    const nextRouteId = sanitizeRouteId(routeId);
    const currentRouteId = sanitizeRouteId(url.searchParams.get(ROUTE_ID_QUERY_PARAM));

    if (
      url.searchParams.get(GAME_ID_QUERY_PARAM) === nextGameId &&
      currentRouteId === nextRouteId
    ) {
      return;
    }

    url.searchParams.set(GAME_ID_QUERY_PARAM, nextGameId);
    if (nextRouteId) {
      url.searchParams.set(ROUTE_ID_QUERY_PARAM, nextRouteId);
    } else {
      url.searchParams.delete(ROUTE_ID_QUERY_PARAM);
    }

    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // Ignore URL update failures and continue.
  }
}

export function navigateToGame(gameId) {
  const nextGameId = sanitizeGameId(gameId);
  if (!nextGameId) return;

  writeStoredGameId(nextGameId);

  const url = new URL(window.location.href);
  url.searchParams.set(GAME_ID_QUERY_PARAM, nextGameId);
  url.searchParams.delete(ROUTE_ID_QUERY_PARAM);
  window.location.assign(`${url.pathname}${url.search}${url.hash}`);
}

export function navigateToRoute(routeId) {
  const nextRouteId = sanitizeRouteId(routeId);
  const currentGameId =
    readGameIdFromLocation() ||
    readStoredGameId() ||
    FALLBACK_GAME_ID;

  writeStoredRouteId(currentGameId, nextRouteId);

  const url = new URL(window.location.href);
  url.searchParams.set(GAME_ID_QUERY_PARAM, currentGameId);

  if (nextRouteId) {
    url.searchParams.set(ROUTE_ID_QUERY_PARAM, nextRouteId);
  } else {
    url.searchParams.delete(ROUTE_ID_QUERY_PARAM);
  }

  window.location.assign(`${url.pathname}${url.search}${url.hash}`);
}

export function populateGamePicker({ selectId = "gamePicker", manifest, currentGameId, onChange }) {
  const select = document.getElementById(selectId);
  if (!(select instanceof HTMLSelectElement)) return;

  const games = Array.isArray(manifest?.games) ? manifest.games : [];

  select.innerHTML = games
    .map((game) => {
      const id = sanitizeGameId(game?.id);
      const title = game?.title || id || "Unknown Game";
      const selected = id === currentGameId ? " selected" : "";
      return `<option value="${id}"${selected}>${title}</option>`;
    })
    .join("");

  select.value = currentGameId;
  select.addEventListener("change", () => {
    const nextGameId = sanitizeGameId(select.value);
    if (!nextGameId || nextGameId === currentGameId) return;
    onChange?.(nextGameId);
  });
}

export function populateRoutePicker({
  selectId = "routePicker",
  routes,
  currentRouteId,
  onChange
}) {
  const select = document.getElementById(selectId);
  if (!(select instanceof HTMLSelectElement)) return;

  const field = select.closest(".gamePickerField");
  const routeEntries = Array.isArray(routes) ? routes : [];
  const hasChoices = routeEntries.length > 1;

  if (field) {
    field.hidden = !hasChoices;
  }

  if (!routeEntries.length) {
    select.innerHTML = "";
    select.value = "";
    return;
  }

  select.innerHTML = routeEntries
    .map((route) => {
      const id = sanitizeRouteId(route?.id);
      const title = route?.title || route?.label || id || "Unknown Route";
      const selected = id === currentRouteId ? " selected" : "";
      return `<option value="${id}"${selected}>${title}</option>`;
    })
    .join("");

  select.value = currentRouteId;
  select.addEventListener("change", () => {
    const nextRouteId = sanitizeRouteId(select.value);
    if (nextRouteId === currentRouteId) return;
    onChange?.(nextRouteId);
  });
}

export async function resolvePageGame(preferredGameId = "") {
  const manifest = await loadGamesManifest();
  const manifestGames = Array.isArray(manifest?.games) ? manifest.games : [];
  const fallbackGameId =
    sanitizeGameId(manifest?.defaultGameId) ||
    sanitizeGameId(manifestGames[0]?.id) ||
    FALLBACK_GAME_ID;

  const requestedGameId =
    sanitizeGameId(preferredGameId) ||
    readGameIdFromLocation() ||
    readStoredGameId() ||
    fallbackGameId;

  const gameEntry =
    manifestGames.find((game) => sanitizeGameId(game?.id) === requestedGameId) ||
    manifestGames.find((game) => sanitizeGameId(game?.id) === fallbackGameId) ||
    null;

  const gameId = sanitizeGameId(gameEntry?.id) || fallbackGameId;
  const requestedRouteId = readRouteIdFromLocation();

  writeStoredGameId(gameId);
  syncGameContextInUrl(gameId, requestedRouteId);
  updateGameLinks(gameId, requestedRouteId);

  return {
    manifest,
    gameId,
    gameEntry
  };
}

export function resolvePageRoute({ gameId, meta, preferredRouteId = "" }) {
  const routes = Array.isArray(meta?.routes) ? meta.routes : [];
  const fallbackRouteId =
    sanitizeRouteId(meta?.defaultRouteId) ||
    sanitizeRouteId(routes[0]?.id) ||
    "";

  const requestedRouteId =
    sanitizeRouteId(preferredRouteId) ||
    readRouteIdFromLocation() ||
    readStoredRouteId(gameId) ||
    fallbackRouteId;

  const routeEntry =
    routes.find((route) => sanitizeRouteId(route?.id) === requestedRouteId) ||
    routes.find((route) => sanitizeRouteId(route?.id) === fallbackRouteId) ||
    null;

  const routeId = sanitizeRouteId(routeEntry?.id) || fallbackRouteId;

  writeStoredRouteId(gameId, routeId);
  syncGameContextInUrl(gameId, routeId);
  updateGameLinks(gameId, routeId);

  return {
    routeId,
    routeEntry,
    routes
  };
}

export async function resolvePageContext({ preferredGameId = "", preferredRouteId = "" } = {}) {
  const pageGame = await resolvePageGame(preferredGameId);
  const meta = await loadGameMeta(pageGame.gameId);
  const pageRoute = resolvePageRoute({
    gameId: pageGame.gameId,
    meta,
    preferredRouteId
  });

  return {
    ...pageGame,
    meta,
    routeId: pageRoute.routeId,
    routeEntry: pageRoute.routeEntry,
    routes: pageRoute.routes
  };
}
