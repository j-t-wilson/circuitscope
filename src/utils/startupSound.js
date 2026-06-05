let audioContext = null;
let sequenceIndex = 0;
let lightSequenceIndex = 0;
const SOUND_SEQUENCE = ['firelight', 'ember', 'clearing', 'firelight']; // Dark mode: campfire at night
const LIGHT_SOUND_SEQUENCE = ['daybreak', 'birdsong', 'meadow', 'daybreak']; // Light mode: brisk sunrise morning

function getAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioContext;
}

export function initAudioContext() {
  try {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
  } catch (e) {}
}

// ============================================================
// Shared Audio Utilities
// ============================================================

function createImpulseResponse(ctx, duration = 2.0, decay = 2.5) {
  const length = ctx.sampleRate * duration;
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
}

function createAudioChain(ctx, reverbDuration = 1.8, reverbDecay = 2.5, dryMix = 0.72, wetMix = 0.28, masterVol = 0.7) {
  const masterGain = ctx.createGain();
  masterGain.gain.value = masterVol;
  masterGain.connect(ctx.destination);

  const convolver = ctx.createConvolver();
  convolver.buffer = createImpulseResponse(ctx, reverbDuration, reverbDecay);

  const reverbGain = ctx.createGain();
  reverbGain.gain.value = wetMix;

  const dryGain = ctx.createGain();
  dryGain.gain.value = dryMix;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 6000;
  filter.Q.value = 0.5;

  filter.connect(dryGain);
  filter.connect(convolver);
  convolver.connect(reverbGain);
  dryGain.connect(masterGain);
  reverbGain.connect(masterGain);

  return { filter, masterGain };
}

// Warm plucked string - acoustic guitar-like
function createPluck(ctx, dest, freq, startTime, decayTime, volume, pan = 0, warmth = 0.5) {
  const fundamental = ctx.createOscillator();
  const harmonic2 = ctx.createOscillator();
  const harmonic3 = ctx.createOscillator();
  const harmonic4 = ctx.createOscillator();
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();

  // Triangle for warmth, with harmonic overtones
  fundamental.type = 'triangle';
  fundamental.frequency.value = freq;
  harmonic2.type = 'sine';
  harmonic2.frequency.value = freq * 2;
  harmonic3.type = 'sine';
  harmonic3.frequency.value = freq * 3;
  harmonic4.type = 'sine';
  harmonic4.frequency.value = freq * 4;

  // Quick pluck attack, natural decay
  const attackTime = 0.008;
  gain.gain.setValueAtTime(0.001, startTime);
  gain.gain.linearRampToValueAtTime(volume, startTime + attackTime);
  gain.gain.exponentialRampToValueAtTime(volume * 0.6, startTime + attackTime + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + decayTime);

  // Warm lowpass - starts bright, darkens naturally
  filter.type = 'lowpass';
  const startBrightness = freq * (3 + warmth * 4);
  filter.frequency.setValueAtTime(startBrightness, startTime);
  filter.frequency.exponentialRampToValueAtTime(freq * 2, startTime + decayTime * 0.5);
  filter.Q.value = 0.7;

  // Mix harmonics for rich but warm tone
  const fundamentalGain = ctx.createGain();
  const harmonic2Gain = ctx.createGain();
  const harmonic3Gain = ctx.createGain();
  const harmonic4Gain = ctx.createGain();
  fundamentalGain.gain.value = 1.0;
  harmonic2Gain.gain.value = 0.4 * warmth;
  harmonic3Gain.gain.value = 0.2 * warmth;
  harmonic4Gain.gain.value = 0.1 * warmth;

  fundamental.connect(fundamentalGain);
  harmonic2.connect(harmonic2Gain);
  harmonic3.connect(harmonic3Gain);
  harmonic4.connect(harmonic4Gain);
  fundamentalGain.connect(gain);
  harmonic2Gain.connect(gain);
  harmonic3Gain.connect(gain);
  harmonic4Gain.connect(gain);
  gain.connect(filter);

  if (pan !== 0 && ctx.createStereoPanner) {
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    filter.connect(panner);
    panner.connect(dest);
  } else {
    filter.connect(dest);
  }

  fundamental.start(startTime);
  harmonic2.start(startTime);
  harmonic3.start(startTime);
  harmonic4.start(startTime);
  fundamental.stop(startTime + decayTime + 0.1);
  harmonic2.stop(startTime + decayTime + 0.1);
  harmonic3.stop(startTime + decayTime + 0.1);
  harmonic4.stop(startTime + decayTime + 0.1);
}

// ============================================================
// OPTION A: "Firelight" - Gentle fingerpicked warmth
// Like someone softly playing guitar by the fire
// G major arpeggio with a touch of added 9th for sweetness
// ============================================================

function playFirelightFull() {
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') ctx.resume();
  const now = ctx.currentTime;

  // Warm, intimate reverb
  const { filter } = createAudioChain(ctx, 2.2, 3.0, 0.68, 0.32, 0.85);

  // Notes: G major with add9 flavor
  const G2 = 98.00, B2 = 123.47, D3 = 146.83, G3 = 196.00, A3 = 220.00, B3 = 246.94, D4 = 293.66, G4 = 392.00;

  // Gentle fingerpicked pattern - like settling in by the fire
  // Tempo ~90 BPM, relaxed swing feel
  const t = 0.33; // eighth note

  // Bar 1: G major arpeggio ascending
  createPluck(ctx, filter, G2, now, 2.5, 0.32, -0.15, 0.6);
  createPluck(ctx, filter, D3, now + t * 0.5, 1.8, 0.26, 0, 0.55);
  createPluck(ctx, filter, G3, now + t * 1, 1.5, 0.24, 0.1, 0.5);
  createPluck(ctx, filter, B3, now + t * 1.5, 1.3, 0.22, 0.15, 0.5);
  createPluck(ctx, filter, D4, now + t * 2, 1.2, 0.20, 0.2, 0.5);

  // Bar 2: Add the sweet 9th (A), descend a bit
  createPluck(ctx, filter, A3, now + t * 3, 1.4, 0.24, 0.1, 0.55);
  createPluck(ctx, filter, G3, now + t * 3.5, 1.2, 0.22, 0.05, 0.5);
  createPluck(ctx, filter, B2, now + t * 4, 1.8, 0.26, -0.1, 0.55);

  // Bar 3: Gentle resolution - warm low G with harmonics blooming
  createPluck(ctx, filter, G2, now + t * 5, 2.8, 0.34, -0.15, 0.65);
  createPluck(ctx, filter, D3, now + t * 5.3, 2.4, 0.26, 0, 0.6);
  createPluck(ctx, filter, G3, now + t * 5.6, 2.2, 0.24, 0.1, 0.55);
  createPluck(ctx, filter, B3, now + t * 5.9, 2.0, 0.20, 0.18, 0.5);
  createPluck(ctx, filter, G4, now + t * 6.2, 1.8, 0.16, 0.25, 0.5);
}


// ============================================================
// OPTION B: "Ember" - Bittersweet warmth
// Em(add9) warm but with a touch of longing
// Open low E drone with delicate upper voice movement
// ============================================================

function playEmberFull() {
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') ctx.resume();
  const now = ctx.currentTime;

  const { filter } = createAudioChain(ctx, 2.4, 3.2, 0.65, 0.35, 0.82);

  // E minor add9 voicing - bittersweet color
  const E2 = 82.41, B2 = 123.47, E3 = 164.81, G3 = 196.00, B3 = 246.94, D4 = 293.66, Fs4 = 369.99, G4 = 392.00;

  const t = 0.36; // unhurried

  // Low E drone - anchor that sustains throughout
  createPluck(ctx, filter, E2, now, 4.0, 0.30, -0.2, 0.55);

  // Em(add9) arpeggio - B is the 5th, F# is the 9
  createPluck(ctx, filter, B2, now + t * 0.5, 2.8, 0.24, -0.1, 0.5);
  createPluck(ctx, filter, E3, now + t * 1, 2.4, 0.22, 0, 0.5);
  createPluck(ctx, filter, G3, now + t * 1.5, 2.0, 0.20, 0.08, 0.48);
  createPluck(ctx, filter, Fs4, now + t * 2, 1.6, 0.18, 0.18, 0.5); // the add9 - gentle tension

  // Brief suspended moment - D natural against the E (the 7th, slightly unresolved)
  createPluck(ctx, filter, D4, now + t * 3, 1.8, 0.20, 0.12, 0.52);
  createPluck(ctx, filter, B3, now + t * 3.5, 1.5, 0.18, 0.05, 0.48);

  // Resolve back to the warm E minor - but voiced openly
  createPluck(ctx, filter, E2, now + t * 4.5, 2.8, 0.32, -0.2, 0.6);
  createPluck(ctx, filter, B2, now + t * 4.7, 2.5, 0.24, -0.08, 0.55);
  createPluck(ctx, filter, E3, now + t * 4.9, 2.3, 0.22, 0, 0.52);
  createPluck(ctx, filter, G3, now + t * 5.1, 2.1, 0.20, 0.1, 0.5);
  createPluck(ctx, filter, B3, now + t * 5.3, 1.9, 0.16, 0.2, 0.48);
}


// ============================================================
// OPTION C: "Clearing" - Suspended to resolved
// Dsus4 → D with open A drone - that moment of clarity
// Stacked 4ths opening up to warmth
// ============================================================

function playClearingFull() {
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') ctx.resume();
  const now = ctx.currentTime;

  const { filter } = createAudioChain(ctx, 2.3, 3.0, 0.66, 0.34, 0.84);

  // D with sus4 resolving - open A string drone underneath
  const A2 = 110.00, D3 = 146.83, A3 = 220.00, D4 = 293.66, G4 = 392.00, A4 = 440.00, Fs4 = 369.99;

  const t = 0.34;

  // Open A drone - the constant, grounding presence
  createPluck(ctx, filter, A2, now, 4.2, 0.28, -0.18, 0.52);

  // Dsus4 voicing - D A D G (stacked 4ths, unresolved)
  createPluck(ctx, filter, D3, now + t * 0.4, 2.6, 0.26, -0.08, 0.55);
  createPluck(ctx, filter, A3, now + t * 0.9, 2.2, 0.22, 0.02, 0.5);
  createPluck(ctx, filter, D4, now + t * 1.4, 1.9, 0.20, 0.12, 0.5);
  createPluck(ctx, filter, G4, now + t * 1.9, 1.6, 0.18, 0.22, 0.52); // the sus4 - tension

  // Let it hang... then the 4th slides down to 3rd
  createPluck(ctx, filter, Fs4, now + t * 3.2, 1.8, 0.20, 0.18, 0.55); // resolution to major 3rd

  // Restate the drone, let it breathe
  createPluck(ctx, filter, A2, now + t * 4, 2.6, 0.26, -0.15, 0.54);
  createPluck(ctx, filter, D3, now + t * 4.3, 2.3, 0.22, -0.05, 0.52);

  // Final D major - warmth achieved
  createPluck(ctx, filter, D3, now + t * 5.2, 2.6, 0.30, -0.12, 0.6);
  createPluck(ctx, filter, A3, now + t * 5.4, 2.4, 0.24, 0, 0.55);
  createPluck(ctx, filter, D4, now + t * 5.6, 2.2, 0.22, 0.1, 0.52);
  createPluck(ctx, filter, Fs4, now + t * 5.8, 2.0, 0.18, 0.2, 0.5);
  createPluck(ctx, filter, A4, now + t * 6.0, 1.8, 0.14, 0.28, 0.48);
}

// ============================================================
// LIGHT MODE SOUNDS - Brisk sunrise, cool forest morning
// ============================================================

// ============================================================
// OPTION D: "Daybreak" - Crystalline morning light
// D major arpeggio - bright and open like first rays through trees
// Crisper reverb, more articulate attack
// ============================================================

function playDaybreakFull() {
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') ctx.resume();
  const now = ctx.currentTime;

  // Crisper, more airy reverb for morning clarity
  const { filter } = createAudioChain(ctx, 1.8, 2.2, 0.75, 0.25, 0.82);

  // D major - bright and crystalline
  const D2 = 73.42, A2 = 110.00, D3 = 146.83, Fs3 = 185.00, A3 = 220.00;
  const D4 = 293.66, Fs4 = 369.99, A4 = 440.00, D5 = 587.33;

  const t = 0.28; // Slightly quicker, more awake

  // Open D string drone - the foundation of morning
  createPluck(ctx, filter, D2, now, 3.2, 0.28, -0.12, 0.42);

  // Ascending D major - reaching up to greet the sun
  createPluck(ctx, filter, A2, now + t * 0.4, 2.4, 0.24, -0.05, 0.40);
  createPluck(ctx, filter, D3, now + t * 0.8, 2.0, 0.22, 0.02, 0.38);
  createPluck(ctx, filter, Fs3, now + t * 1.2, 1.7, 0.20, 0.10, 0.38);
  createPluck(ctx, filter, A3, now + t * 1.6, 1.5, 0.19, 0.16, 0.36);
  createPluck(ctx, filter, D4, now + t * 2.0, 1.3, 0.17, 0.22, 0.35);

  // High crystalline notes - the sparkle of dew
  createPluck(ctx, filter, Fs4, now + t * 2.8, 1.4, 0.16, 0.25, 0.38);
  createPluck(ctx, filter, A4, now + t * 3.2, 1.2, 0.14, 0.28, 0.36);

  // Gentle descent and resolution
  createPluck(ctx, filter, D4, now + t * 4.0, 1.8, 0.18, 0.18, 0.40);
  createPluck(ctx, filter, A3, now + t * 4.3, 1.6, 0.16, 0.10, 0.38);

  // Final D major chord - the sun fully risen
  createPluck(ctx, filter, D2, now + t * 5.0, 2.6, 0.30, -0.12, 0.45);
  createPluck(ctx, filter, A2, now + t * 5.2, 2.4, 0.24, -0.02, 0.42);
  createPluck(ctx, filter, D3, now + t * 5.4, 2.2, 0.22, 0.08, 0.40);
  createPluck(ctx, filter, Fs3, now + t * 5.6, 2.0, 0.18, 0.16, 0.38);
  createPluck(ctx, filter, A3, now + t * 5.8, 1.8, 0.15, 0.24, 0.36);
}


// ============================================================
// OPTION E: "Birdsong" - Hopeful morning awakening
// A major add9 - bright, optimistic, like birdsong at dawn
// Quick, gentle phrases suggesting morning birds stirring
// ============================================================

function playBirdsongFull() {
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') ctx.resume();
  const now = ctx.currentTime;

  // Light, airy reverb
  const { filter } = createAudioChain(ctx, 1.9, 2.4, 0.73, 0.27, 0.80);

  // A major add9 - hopeful and bright (B is the 9)
  const A2 = 110.00, E3 = 164.81, A3 = 220.00, Cs4 = 277.18;
  const E4 = 329.63, A4 = 440.00, B4 = 493.88, Cs5 = 554.37;

  const t = 0.30;

  // Open A drone - steady, grounding morning presence
  createPluck(ctx, filter, A2, now, 3.8, 0.26, -0.15, 0.40);

  // First phrase - like a bird's call, quick and light
  createPluck(ctx, filter, E3, now + t * 0.4, 1.6, 0.20, -0.05, 0.38);
  createPluck(ctx, filter, A3, now + t * 0.7, 1.4, 0.19, 0.05, 0.36);
  createPluck(ctx, filter, Cs4, now + t * 1.0, 1.2, 0.18, 0.12, 0.35);
  createPluck(ctx, filter, E4, now + t * 1.3, 1.1, 0.16, 0.18, 0.34);

  // The add9 (B) - that sweet morning color
  createPluck(ctx, filter, B4, now + t * 1.8, 1.4, 0.18, 0.22, 0.38);
  createPluck(ctx, filter, A4, now + t * 2.1, 1.3, 0.16, 0.18, 0.36);
  createPluck(ctx, filter, E4, now + t * 2.4, 1.2, 0.15, 0.10, 0.35);

  // Second phrase - answering birdsong
  createPluck(ctx, filter, Cs4, now + t * 3.2, 1.3, 0.17, 0.08, 0.36);
  createPluck(ctx, filter, E4, now + t * 3.5, 1.2, 0.16, 0.14, 0.35);
  createPluck(ctx, filter, A4, now + t * 3.8, 1.1, 0.15, 0.20, 0.34);
  createPluck(ctx, filter, B4, now + t * 4.1, 1.4, 0.17, 0.25, 0.38);

  // Gentle resolution - settling into the morning
  createPluck(ctx, filter, A2, now + t * 5.0, 2.4, 0.28, -0.15, 0.44);
  createPluck(ctx, filter, E3, now + t * 5.2, 2.2, 0.22, -0.05, 0.42);
  createPluck(ctx, filter, A3, now + t * 5.4, 2.0, 0.20, 0.05, 0.40);
  createPluck(ctx, filter, Cs4, now + t * 5.6, 1.8, 0.17, 0.14, 0.38);
  createPluck(ctx, filter, E4, now + t * 5.8, 1.6, 0.14, 0.22, 0.36);
}


// ============================================================
// OPTION F: "Meadow" - Expansive morning light
// E major with Lydian color (raised 4th = A#)
// That moment when mist clears and you see the whole meadow
// Sus4 → major resolution with a shimmer of lydian
// ============================================================

function playMeadowFull() {
  const ctx = getAudioContext();
  if (ctx.state === 'suspended') ctx.resume();
  const now = ctx.currentTime;

  // Open, spacious reverb - the wide meadow
  const { filter } = createAudioChain(ctx, 2.0, 2.6, 0.70, 0.30, 0.83);

  // E major with Lydian A# color
  const E2 = 82.41, B2 = 123.47, E3 = 164.81, Gs3 = 207.65, B3 = 246.94;
  const E4 = 329.63, Gs4 = 415.30, As4 = 466.16, B4 = 493.88;

  const t = 0.32;

  // Open E drone - the vast, grounding earth
  createPluck(ctx, filter, E2, now, 4.0, 0.28, -0.18, 0.42);

  // Esus4 voicing first - B E A (stacked 4ths, that suspended feeling)
  createPluck(ctx, filter, B2, now + t * 0.4, 2.6, 0.24, -0.08, 0.40);
  createPluck(ctx, filter, E3, now + t * 0.8, 2.2, 0.22, 0, 0.38);
  createPluck(ctx, filter, B3, now + t * 1.2, 1.8, 0.20, 0.10, 0.38);
  createPluck(ctx, filter, E4, now + t * 1.6, 1.5, 0.18, 0.18, 0.36);

  // The Lydian shimmer - A# instead of A, that magical brightness
  createPluck(ctx, filter, As4, now + t * 2.4, 1.6, 0.17, 0.24, 0.40);

  // Let it hang... then resolve to G# (major 3rd)
  createPluck(ctx, filter, Gs4, now + t * 3.2, 1.8, 0.19, 0.20, 0.42);
  createPluck(ctx, filter, E4, now + t * 3.5, 1.5, 0.17, 0.14, 0.38);

  // Return to the drone, breathe
  createPluck(ctx, filter, E2, now + t * 4.2, 2.4, 0.26, -0.16, 0.44);
  createPluck(ctx, filter, B2, now + t * 4.5, 2.2, 0.22, -0.06, 0.42);

  // Final E major - the mist has cleared, full morning light
  createPluck(ctx, filter, E2, now + t * 5.2, 2.8, 0.30, -0.16, 0.46);
  createPluck(ctx, filter, B2, now + t * 5.4, 2.6, 0.24, -0.04, 0.44);
  createPluck(ctx, filter, E3, now + t * 5.6, 2.4, 0.22, 0.04, 0.42);
  createPluck(ctx, filter, Gs3, now + t * 5.8, 2.2, 0.19, 0.14, 0.40);
  createPluck(ctx, filter, B3, now + t * 6.0, 2.0, 0.16, 0.22, 0.38);
  createPluck(ctx, filter, E4, now + t * 6.2, 1.8, 0.13, 0.28, 0.36);
}


// ============================================================
// Public API
// ============================================================

export function playStartupSound(isDark = true) {
  try {
    if (isDark) {
      // Dark mode: campfire at night
      const currentSound = SOUND_SEQUENCE[sequenceIndex];

      switch (currentSound) {
        case 'firelight':
          playFirelightFull();
          break;
        case 'ember':
          playEmberFull();
          break;
        case 'clearing':
          playClearingFull();
          break;
      }

      sequenceIndex = (sequenceIndex + 1) % SOUND_SEQUENCE.length;
    } else {
      // Light mode: brisk sunrise morning
      const currentSound = LIGHT_SOUND_SEQUENCE[lightSequenceIndex];

      switch (currentSound) {
        case 'daybreak':
          playDaybreakFull();
          break;
        case 'birdsong':
          playBirdsongFull();
          break;
        case 'meadow':
          playMeadowFull();
          break;
      }

      lightSequenceIndex = (lightSequenceIndex + 1) % LIGHT_SOUND_SEQUENCE.length;
    }
  } catch (e) {
    console.warn('Startup sound failed:', e);
  }
}

export function resetStartupSound() {
  sequenceIndex = 0;
  lightSequenceIndex = 0;
}
