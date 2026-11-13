export const PLAYBACK_DEFAULTS = Object.freeze({ autoplay: false, autoplaySpeed: 4, autoStopAtMedals: true });

function boolean(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'string') return ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase());
  return Boolean(value);
}

export function normalizePlaybackOptions(raw = {}) {
  const speed = Number(raw.autoplaySpeed);
  return {
    autoplay: boolean(raw.autoplay, PLAYBACK_DEFAULTS.autoplay),
    autoplaySpeed: raw.autoplaySpeed != null && raw.autoplaySpeed !== '' && Number.isFinite(speed) && speed > 0
      ? Math.max(0.25, Math.min(16, speed)) : PLAYBACK_DEFAULTS.autoplaySpeed,
    autoStopAtMedals: boolean(raw.autoStopAtMedals, PLAYBACK_DEFAULTS.autoStopAtMedals),
  };
}
