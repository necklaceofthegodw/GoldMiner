const DEFAULT_VOLUME = 0.055;

function createEnvelope(context, gainValue, duration) {
  const gain = context.createGain();
  const now = context.currentTime;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, gainValue), now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  return gain;
}

function pulse(context, options) {
  const {
    frequency = 440,
    duration = 0.1,
    type = "sine",
    volume = DEFAULT_VOLUME,
    slide = 0,
  } = options;

  const oscillator = context.createOscillator();
  const gain = createEnvelope(context, volume, duration);
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, context.currentTime);
  if (slide !== 0) {
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(40, frequency + slide),
      context.currentTime + duration
    );
  }
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + duration + 0.02);
}

function getContext(audio) {
  if (audio.context) return audio.context;
  const ctor = window.AudioContext || window.webkitAudioContext;
  if (!ctor) return null;
  audio.context = new ctor();
  return audio.context;
}

export function createSoundEngine(enabled = true) {
  return {
    enabled,
    context: null,
  };
}

export function setSoundEnabled(audio, enabled) {
  audio.enabled = enabled;
}

export function playSound(audio, eventId) {
  if (!audio.enabled) return;
  const context = getContext(audio);
  if (!context) return;

  if (context.state === "suspended") {
    context.resume().catch(() => {});
  }

  if (eventId === "hook-launch") {
    pulse(context, { frequency: 300, duration: 0.08, type: "triangle", slide: 120 });
  } else if (eventId === "gold") {
    pulse(context, { frequency: 520, duration: 0.1, type: "triangle", slide: 190 });
  } else if (eventId === "diamond") {
    pulse(context, { frequency: 720, duration: 0.09, type: "square", slide: 260 });
  } else if (eventId === "mystery") {
    pulse(context, { frequency: 430, duration: 0.08, type: "sine", slide: 90 });
    pulse(context, { frequency: 640, duration: 0.12, type: "sine", volume: DEFAULT_VOLUME * 0.7, slide: -80 });
  } else if (eventId === "rock") {
    pulse(context, { frequency: 140, duration: 0.1, type: "sawtooth", slide: -30 });
  } else if (eventId === "level-win") {
    pulse(context, { frequency: 460, duration: 0.14, type: "triangle", slide: 220 });
    pulse(context, { frequency: 680, duration: 0.18, type: "triangle", volume: DEFAULT_VOLUME * 0.8, slide: 260 });
  } else if (eventId === "level-lose") {
    pulse(context, { frequency: 230, duration: 0.18, type: "square", slide: -80 });
  } else if (eventId === "shop-buy") {
    pulse(context, { frequency: 620, duration: 0.09, type: "sine", slide: 160 });
  } else if (eventId === "error") {
    pulse(context, { frequency: 180, duration: 0.08, type: "square", slide: -45 });
  } else if (eventId === "start-level") {
    pulse(context, { frequency: 390, duration: 0.08, type: "triangle", slide: 120 });
  }
}

export function playSoundBatch(audio, eventIds) {
  for (const eventId of eventIds) {
    playSound(audio, eventId);
  }
}
