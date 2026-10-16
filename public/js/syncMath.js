export function clamp(val, min, max) {
  return Math.min(max, Math.max(min, val));
}

export function computeExpectedPosition(playback, serverNow) {
  if (!playback) return 0;
  if (playback.status === 'playing') {
    return (playback.position || 0) + Math.max(0, (serverNow - playback.updatedAt) / 1000);
  }
  return playback.position || 0;
}

export function computeCorrection({ playing, current, expected, rate = 1 }) {
  const drift = current - expected;
  const absDrift = Math.abs(drift);

  if (absDrift > 0.5) {
    return {
      action: 'seek',
      target: expected,
      rate: 1,
      drift
    };
  }

  if (playing) {
    if (absDrift >= 0.08) {
      const nudge = clamp(-drift * 0.5, -0.06, 0.06);
      return {
        action: 'nudge',
        rate: 1 + nudge,
        drift
      };
    }
    return {
      action: 'none',
      rate: 1,
      drift
    };
  }

  // Paused state
  if (absDrift > 0.25) {
    return {
      action: 'seek',
      target: expected,
      rate: 1,
      drift
    };
  }

  return {
    action: 'none',
    rate: 1,
    drift
  };
}
