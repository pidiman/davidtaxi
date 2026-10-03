/**
 * Zvonenie pri novej jazde (Web Audio – bez zvukového súboru) + vibrácie v slučke.
 *
 * Prehliadače pustia zvuk až po prvom dotyku používateľa na stránke, preto
 * `unlockAudio()` beží pri každom dotyku a AudioContext „odomkne“ vopred
 * (napr. keď vodič klikne Začať smenu). Potom môže alarm zaznieť aj bez ďalšieho dotyku.
 */
let ctx: AudioContext | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let titleTimer: ReturnType<typeof setInterval> | null = null;
let originalTitle = '';

function audio(): AudioContext | null {
  try {
    if (!ctx) {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

export function unlockAudio() {
  const c = audio();
  if (!c) return;
  // tichý „ping“ – na iOS odomkne zvukový výstup
  const o = c.createOscillator();
  const g = c.createGain();
  g.gain.value = 0;
  o.connect(g).connect(c.destination);
  o.start();
  o.stop(c.currentTime + 0.01);
}

/** Jedno zazvonenie: dvojtón ako pri taxi vysielačke, 3× rýchlo za sebou. */
function ring(volume = 0.5) {
  const c = audio();
  if (!c) return;
  const t0 = c.currentTime + 0.02;
  for (let i = 0; i < 3; i++) {
    for (const [freq, off] of [
      [988, 0],
      [1319, 0.13],
    ] as const) {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'square';
      o.frequency.value = freq;
      const start = t0 + i * 0.32 + off;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(volume * 0.35, start + 0.01);
      g.gain.setValueAtTime(volume * 0.35, start + 0.1);
      g.gain.linearRampToValueAtTime(0, start + 0.12);
      o.connect(g).connect(c.destination);
      o.start(start);
      o.stop(start + 0.13);
    }
  }
}

/** Spustí zvonenie + vibrácie + blikanie titulku, kým sa nezavolá stopAlarm(). */
export function startAlarm(title = 'NOVÁ JAZDA') {
  if (timer) return;
  const tick = () => {
    ring();
    navigator.vibrate?.([400, 150, 400, 150, 400]);
  };
  tick();
  timer = setInterval(tick, 2200);

  originalTitle = document.title;
  let on = false;
  titleTimer = setInterval(() => {
    on = !on;
    document.title = on ? `🚕 ${title}` : originalTitle;
  }, 1000);
}

export function stopAlarm() {
  if (timer) clearInterval(timer);
  if (titleTimer) clearInterval(titleTimer);
  timer = null;
  titleTimer = null;
  if (originalTitle) document.title = originalTitle;
  navigator.vibrate?.(0);
}

/** Skúška zvuku z nastavení vodiča. */
export function testRing() {
  unlockAudio();
  ring();
  navigator.vibrate?.([300, 100, 300]);
}
