const STORAGE_KEY = "platinum-router-media-source";

const sourceForm = document.getElementById("mediaSourceForm");
const sourceInput = document.getElementById("mediaSourceInput");
const stage = document.getElementById("mediaStage");
const player = document.getElementById("mediaPlayer");
const chatFrame = document.getElementById("mediaChatFrame");
const chat = document.getElementById("mediaChat");
const emptyState = document.getElementById("mediaEmptyState");
const platformPill = document.getElementById("mediaPlatformPill");
const status = document.getElementById("mediaStatus");
const chatToggle = document.getElementById("mediaChatToggle");
const clearButton = document.getElementById("mediaClearBtn");

function safeUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;

  try {
    return new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
}

function parseYouTube(url) {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!["youtube.com", "m.youtube.com", "youtu.be"].includes(host)) return null;

  const parts = url.pathname.split("/").filter(Boolean);
  let videoId = "";

  if (host === "youtu.be") videoId = parts[0] || "";
  else if (url.pathname === "/watch") videoId = url.searchParams.get("v") || "";
  else if (["embed", "shorts", "live"].includes(parts[0])) videoId = parts[1] || "";

  videoId = videoId.match(/^[\w-]{6,20}$/)?.[0] || "";
  if (!videoId) {
    return { error: "Use a YouTube video or live-stream URL, not a channel page." };
  }

  const domain = window.location.hostname || "localhost";
  return {
    platform: "YouTube",
    playerUrl: `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?autoplay=1&playsinline=1`,
    chatUrl: `https://www.youtube.com/live_chat?v=${encodeURIComponent(videoId)}&embed_domain=${encodeURIComponent(domain)}`,
    hasChat: true
  };
}

function parseTwitch(url) {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!["twitch.tv", "m.twitch.tv"].includes(host)) return null;

  const parts = url.pathname.split("/").filter(Boolean);
  const reserved = new Set(["directory", "downloads", "jobs", "p", "search", "settings", "subscriptions", "videos"]);
  const parent = window.location.hostname || "localhost";
  const isVideo = parts[0]?.toLowerCase() === "videos" && /^\d+$/.test(parts[1] || "");
  const channel = !isVideo && parts[0] && !reserved.has(parts[0].toLowerCase()) ? parts[0] : "";

  if (!isVideo && !channel) {
    return { error: "Use a Twitch channel URL or a Twitch video URL." };
  }

  const playerTarget = isVideo
    ? `video=v${encodeURIComponent(parts[1])}`
    : `channel=${encodeURIComponent(channel)}`;

  return {
    platform: "Twitch",
    playerUrl: `https://player.twitch.tv/?${playerTarget}&parent=${encodeURIComponent(parent)}&autoplay=true`,
    chatUrl: channel
      ? `https://www.twitch.tv/embed/${encodeURIComponent(channel)}/chat?parent=${encodeURIComponent(parent)}&darkpopout`
      : "",
    hasChat: Boolean(channel)
  };
}

function parseSource(value) {
  const url = safeUrl(value);
  if (!url) return { error: "Enter a valid YouTube or Twitch URL." };

  return parseYouTube(url) || parseTwitch(url) || {
    error: "That link is not from YouTube or Twitch."
  };
}

function setChatVisible(visible) {
  const available = Boolean(chat.src);
  chatFrame.hidden = !visible || !available;
  stage.classList.toggle("chatHidden", !visible || !available);
  chatToggle.setAttribute("aria-pressed", String(visible));
  chatToggle.textContent = visible ? "Hide Chat" : "Show Chat";
}

function showError(message) {
  status.textContent = message;
  status.dataset.tone = "error";
  sourceInput.setAttribute("aria-invalid", "true");
  sourceInput.focus();
}

function loadSource(value, { remember = true } = {}) {
  const source = parseSource(value);
  if (source.error) {
    showError(source.error);
    return;
  }

  sourceInput.removeAttribute("aria-invalid");
  status.removeAttribute("data-tone");
  player.src = source.playerUrl;
  chat.src = source.chatUrl;
  stage.hidden = false;
  emptyState.hidden = true;
  platformPill.textContent = source.platform;
  platformPill.dataset.platform = source.platform.toLowerCase();
  status.textContent = source.hasChat
    ? `${source.platform} player and live chat loaded.`
    : `${source.platform} video loaded. Chat is available for live channels.`;
  chatToggle.hidden = !source.hasChat;
  clearButton.hidden = false;
  setChatVisible(source.hasChat);

  if (remember) {
    try {
      localStorage.setItem(STORAGE_KEY, String(value).trim());
    } catch {
      // The player still works when browser storage is unavailable.
    }
  }
}

function clearSource() {
  player.src = "";
  chat.src = "";
  stage.hidden = true;
  emptyState.hidden = false;
  platformPill.textContent = "Ready";
  platformPill.removeAttribute("data-platform");
  status.textContent = "No stream loaded.";
  status.removeAttribute("data-tone");
  chatToggle.hidden = true;
  clearButton.hidden = true;
  sourceInput.value = "";
  sourceInput.removeAttribute("aria-invalid");

  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing else is needed if browser storage is unavailable.
  }
}

sourceForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  loadSource(sourceInput.value);
});

chatToggle?.addEventListener("click", () => {
  const visible = chatToggle.getAttribute("aria-pressed") !== "true";
  setChatVisible(visible);
});

clearButton?.addEventListener("click", clearSource);

try {
  const savedSource = localStorage.getItem(STORAGE_KEY);
  if (savedSource) {
    sourceInput.value = savedSource;
    loadSource(savedSource, { remember: false });
  }
} catch {
  // Start with an empty dock when browser storage is unavailable.
}
