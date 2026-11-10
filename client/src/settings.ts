// Player settings, kept per device in localStorage.
export interface Settings {
  quality: 'high' | 'mid' | 'low';   // canvas resolution: device pixels capped at 3 / 2 / 1
  fps: 60 | 30;                      // 30 = battery saver
  weatherFx: boolean;                // rain / fog / clouds drawn on screen (crops are still watered by rain)
  ambientFx: boolean;                // butterflies, floating leaves, dust motes
  cropBars: boolean;                 // status bar + markers above each crop
  nameTag: boolean;                  // name above the character
  showFps: boolean;
}
const KEY = 'gnt_settings';
const DEFAULTS: Settings = { quality: 'high', fps: 60, weatherFx: true, ambientFx: true, cropBars: true, nameTag: true, showFps: false };

function load(): Settings {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
}
export const settings: Settings = load();
export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch { /* ignore */ }
}
export const dprCap = () => (settings.quality === 'high' ? 3 : settings.quality === 'mid' ? 2 : 1);
