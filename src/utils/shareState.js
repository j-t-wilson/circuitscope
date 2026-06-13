// Shareable/persistent app state.
// The analyzed circuit (and optionally the selected detector) is encoded in the
// URL hash as #c=<base64url circuit>&d=<detector>, so a refresh restores the
// session and the URL can be sent to a colleague. localStorage keeps a backup
// of the last analyzed circuit for fresh tabs without a hash.

const LAST_CIRCUIT_KEY = 'circuitscope-last-circuit';
// Browsers comfortably handle URLs far longer than this; cap to stay portable
// across chat clients and issue trackers that truncate long links.
const MAX_HASH_LENGTH = 8000;

function encodeBase64Url(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  bytes.forEach(b => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeBase64Url(encoded) {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function readShareState() {
  const hash = window.location.hash.slice(1);
  if (!hash) return null;
  const params = new URLSearchParams(hash);
  const encoded = params.get('c');
  if (!encoded) return null;
  try {
    return { circuit: decodeBase64Url(encoded), detector: params.get('d') };
  } catch {
    return null;
  }
}

export function writeShareState(circuitText, detector) {
  const { pathname, search } = window.location;
  if (!circuitText) {
    history.replaceState(null, '', pathname + search);
    return;
  }
  const params = new URLSearchParams();
  params.set('c', encodeBase64Url(circuitText));
  if (detector) params.set('d', detector);
  const hash = `#${params.toString()}`;
  if (hash.length <= MAX_HASH_LENGTH) {
    history.replaceState(null, '', pathname + search + hash);
  }
}

// Full shareable URL for the given state, or null when the circuit exceeds
// the hash cap (in which case the address bar hash is also absent).
export function buildShareUrl(circuitText, detector) {
  if (!circuitText) return null;
  const { origin, pathname, search } = window.location;
  const params = new URLSearchParams();
  params.set('c', encodeBase64Url(circuitText));
  if (detector) params.set('d', detector);
  const hash = `#${params.toString()}`;
  if (hash.length > MAX_HASH_LENGTH) return null;
  return origin + pathname + search + hash;
}

export function readLastCircuit() {
  try {
    return localStorage.getItem(LAST_CIRCUIT_KEY) || '';
  } catch {
    return '';
  }
}

export function saveLastCircuit(circuitText) {
  try {
    localStorage.setItem(LAST_CIRCUIT_KEY, circuitText);
  } catch {
    // Storage unavailable (private mode/quota); persistence is best-effort.
  }
}
