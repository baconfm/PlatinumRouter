export const GAME_ID_QUERY_PARAM = "gameId";
export const ROUTE_ID_QUERY_PARAM = "routeId";
export const SELECTED_GAME_STORAGE_KEY = "platinum-router-selected-game";
export const SELECTED_ROUTE_STORAGE_KEY_PREFIX = "platinum-router-selected-route";
export const STATE_STORAGE_KEY_PREFIX = "platinum-router-state";
export const FALLBACK_GAME_ID = "ghost-of-tsushima";
const LEGACY_DEFAULT_ROUTE_IDS = {
  "ghost-of-tsushima": "fresh-start-platinum"
};

export function sanitizeGameId(value) {
  return typeof value === "string" && value.trim()
    ? value.trim().toLowerCase()
    : "";
}

export function sanitizeRouteId(value) {
  return typeof value === "string" && value.trim()
    ? value.trim().toLowerCase()
    : "";
}

export function getLegacyDefaultRouteId(gameId) {
  const nextGameId = sanitizeGameId(gameId) || FALLBACK_GAME_ID;
  return sanitizeRouteId(LEGACY_DEFAULT_ROUTE_IDS[nextGameId]);
}

export function readStoredGameId() {
  try {
    return sanitizeGameId(localStorage.getItem(SELECTED_GAME_STORAGE_KEY));
  } catch {
    return "";
  }
}

export function writeStoredGameId(gameId) {
  const nextGameId = sanitizeGameId(gameId);
  if (!nextGameId) return;

  try {
    localStorage.setItem(SELECTED_GAME_STORAGE_KEY, nextGameId);
  } catch {
    // Ignore storage failures and keep the current page usable.
  }
}

export function getSelectedRouteStorageKey(gameId) {
  const nextGameId = sanitizeGameId(gameId) || FALLBACK_GAME_ID;
  return `${SELECTED_ROUTE_STORAGE_KEY_PREFIX}:${nextGameId}`;
}

export function readStoredRouteId(gameId) {
  try {
    return sanitizeRouteId(localStorage.getItem(getSelectedRouteStorageKey(gameId)));
  } catch {
    return "";
  }
}

export function writeStoredRouteId(gameId, routeId) {
  const nextGameId = sanitizeGameId(gameId) || FALLBACK_GAME_ID;
  const nextRouteId = sanitizeRouteId(routeId);

  try {
    if (nextRouteId) {
      localStorage.setItem(getSelectedRouteStorageKey(nextGameId), nextRouteId);
    } else {
      localStorage.removeItem(getSelectedRouteStorageKey(nextGameId));
    }
  } catch {
    // Ignore storage failures and keep the current page usable.
  }
}

function normalizeRouteStorageSegment(gameId, routeId) {
  const nextRouteId = sanitizeRouteId(routeId);
  const legacyDefaultRouteId = getLegacyDefaultRouteId(gameId);

  if (!nextRouteId || nextRouteId === legacyDefaultRouteId) {
    return "";
  }

  return nextRouteId;
}

export function getStateStorageKey(gameId, routeId = "") {
  const nextGameId = sanitizeGameId(gameId) || FALLBACK_GAME_ID;
  const routeSegment = normalizeRouteStorageSegment(nextGameId, routeId);

  return routeSegment
    ? `${STATE_STORAGE_KEY_PREFIX}:${nextGameId}:${routeSegment}`
    : `${STATE_STORAGE_KEY_PREFIX}:${nextGameId}`;
}
