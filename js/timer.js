export function createTimer({
  initialElapsedMs = 0,
  onTick = () => {},
  onStateChange = () => {}
} = {}) {
  const state = {
    elapsedMs: Math.max(0, Number(initialElapsedMs || 0)),
    running: false,
    startTs: null,
    intervalId: null
  };

  function start() {
    if (state.running) return;
    state.startTs = Date.now() - state.elapsedMs;
    state.intervalId = window.setInterval(() => {
      state.elapsedMs = Date.now() - state.startTs;
      onTick(state.elapsedMs, getSnapshot());
    }, 250);
    state.running = true;
    onStateChange(getSnapshot());
  }

  function pause() {
    if (!state.running) return;
    if (state.intervalId) {
      clearInterval(state.intervalId);
      state.intervalId = null;
    }
    state.elapsedMs = Math.max(0, state.elapsedMs);
    state.running = false;
    state.startTs = null;
    onStateChange(getSnapshot());
  }

  function reset(nextElapsedMs = 0) {
    if (state.intervalId) {
      clearInterval(state.intervalId);
      state.intervalId = null;
    }
    state.elapsedMs = Math.max(0, Number(nextElapsedMs || 0));
    state.running = false;
    state.startTs = null;
    onTick(state.elapsedMs, getSnapshot());
    onStateChange(getSnapshot());
  }

  function setElapsed(nextElapsedMs = 0) {
    state.elapsedMs = Math.max(0, Number(nextElapsedMs || 0));
    if (state.running) {
      state.startTs = Date.now() - state.elapsedMs;
    }
    onTick(state.elapsedMs, getSnapshot());
    onStateChange(getSnapshot());
  }

  function destroy() {
    if (state.intervalId) {
      clearInterval(state.intervalId);
      state.intervalId = null;
    }
    state.running = false;
    state.startTs = null;
  }

  function getSnapshot() {
    return {
      elapsedMs: state.elapsedMs,
      running: state.running
    };
  }

  return {
    start,
    pause,
    reset,
    setElapsed,
    destroy,
    getSnapshot
  };
}