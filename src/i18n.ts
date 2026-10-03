import type { Lang, Txt } from './sim/types';

const S = {
  play: { es: 'JUGAR', en: 'PLAY' },
  continue: { es: 'CONTINUAR', en: 'CONTINUE' },
  levels: { es: 'Recorridos', en: 'Courses' },
  route: { es: 'La gira', en: 'World Tour' },
  routeBtn: { es: 'Gira', en: 'Tour' },
  cabinet: { es: 'Vitrina', en: 'Trophies' },
  cupShort: { es: 'Copa', en: 'Cup' },
  moreSoon: { es: 'Pronto, más recorridos…', en: 'More courses soon…' },
  newCourse: { es: 'Recorrido nuevo', en: 'New course' },
  cupHole: { es: 'Hoyo de copa', en: 'Cup hole' },
  cupCard: { es: 'Acábalo en el par o mejor y ganas la {t}.', en: 'Finish at par or better to win the {t}.' },
  hgoal1: { es: 'Termina el hoyo', en: 'Finish the hole' },
  hgoal2: { es: 'En el par ({p} golpes) o mejor', en: 'Par ({p} strokes) or better' },
  hgoal3: { es: 'Bajo par: {p} golpes o menos', en: 'Under par: {p} strokes or fewer' },
  holeNum: { es: 'Hoyo {n}', en: 'Hole {n}' },
  pickedUp: { es: 'Recogida', en: 'Picked up' },
  tourDone: { es: '¡Gira terminada!', en: 'Tour complete!' },
  daily: { es: 'Reto diario', en: 'Daily round' },
  settings: { es: 'Ajustes', en: 'Settings' },
  camera: { es: 'Cambiar cámara (C)', en: 'Switch camera (C)' },
  tagline: { es: 'Minigolf en sitios donde no debería haber minigolf', en: 'Mini golf where mini golf shouldn’t be' },
  go: { es: '¡A JUGAR!', en: 'TEE OFF!' },
  back: { es: 'Volver', en: 'Back' },
  course: { es: 'Recorrido', en: 'Course' },
  hole: { es: 'Hoyo', en: 'Hole' },
  locked: { es: 'Termina el recorrido anterior', en: 'Finish the previous course' },
  goal1: { es: 'Termina los {n} hoyos', en: 'Finish all {n} holes' },
  goal2: { es: 'Acaba en el par ({p}) o menos', en: 'Finish at par ({p}) or better' },
  goal3: { es: 'Acaba con {p} golpes o menos', en: 'Finish in {p} strokes or fewer' },
  par: { es: 'Par', en: 'Par' },
  strokes: { es: 'Golpes', en: 'Strokes' },
  total: { es: 'Total', en: 'Total' },
  pause: { es: 'Pausa', en: 'Paused' },
  resume: { es: 'Seguir', en: 'Resume' },
  restart: { es: 'Reintentar', en: 'Retry' },
  restartHole: { es: 'Repetir el recorrido', en: 'Restart course' },
  next: { es: 'Siguiente', en: 'Next' },
  nextHole: { es: 'Siguiente hoyo', en: 'Next hole' },
  share: { es: 'Compartir', en: 'Share' },
  menu: { es: 'Menú', en: 'Menu' },
  card: { es: 'Tarjeta', en: 'Scorecard' },
  courseDone: { es: '¡RECORRIDO TERMINADO!', en: 'COURSE COMPLETE!' },
  best: { es: 'Récord', en: 'Best' },
  newBest: { es: '¡Nuevo récord!', en: 'New best!' },
  holesN: { es: '{n} hoyos', en: '{n} holes' },
  sound: { es: 'Efectos', en: 'Sound' },
  music: { es: 'Música', en: 'Music' },
  vibration: { es: 'Vibración', en: 'Vibration' },
  quality: { es: 'Calidad gráfica', en: 'Graphics' },
  gfx_auto: { es: 'Automática', en: 'Automatic' },
  gfx_high: { es: 'Alta', en: 'High' },
  gfx_medium: { es: 'Media', en: 'Medium' },
  gfx_low: { es: 'Ahorro', en: 'Battery saver' },
  newTag: { es: 'NUEVO', en: 'NEW' },
  unlocked: { es: '¡Recorrido {n} desbloqueado!', en: 'Course {n} unlocked!' },
  goalsNow: { es: 'Así vas', en: 'Right now' },
  stats: { es: 'Estadísticas anónimas', en: 'Anonymous stats' },
  privacy: { es: 'Privacidad', en: 'Privacy' },
  statsNote: { es: 'Cómo se juega, sin datos personales', en: 'How the game is played, no personal data' },
  dailyRank: { es: 'Mejor que el {p}% de los {n} jugadores de hoy', en: 'Better than {p}% of today’s {n} players' },
  dailyFirst: { es: '¡Eres de los primeros en jugar el reto de hoy!', en: 'You’re one of the first to play today’s round!' },
  language: { es: 'Idioma', en: 'Language' },
  reset: { es: 'Borrar progreso', en: 'Reset progress' },
  resetConfirm: { es: 'Pulsa otra vez para borrar', en: 'Tap again to confirm' },
  copied: { es: '¡Copiado! Pégalo donde quieras', en: 'Copied! Paste it anywhere' },
  tutTouch: { es: 'Pon el dedo y tira hacia atrás', en: 'Put your thumb down and pull back' },
  tutTouch2: { es: 'Más lejos = más fuerte · Suelta para golpear', en: 'Further = harder · Let go to putt' },
  tutDesk: { es: 'Arrastra con el ratón hacia atrás y suelta · O flechas + mantener Espacio · C: cámara', en: 'Drag back with the mouse and let go · Or arrows + hold Space · C: camera' },
  // scores
  sHio: { es: '¡HOYO EN UNO!', en: 'HOLE IN ONE!' },
  sAlbatross: { es: '¡ALBATROS!', en: 'ALBATROSS!' },
  sEagle: { es: '¡EAGLE!', en: 'EAGLE!' },
  sBirdie: { es: '¡BIRDIE!', en: 'BIRDIE!' },
  sPar: { es: 'PAR', en: 'PAR' },
  sBogey: { es: 'BOGEY', en: 'BOGEY' },
  sDouble: { es: 'DOBLE BOGEY', en: 'DOUBLE BOGEY' },
  sOver: { es: '+{n}', en: '+{n}' },
  sMaxed: { es: 'Recogida (+{n})', en: 'Picked up (+{n})' },
  // in-game
  tWater: { es: '¡Al agua! +1', en: 'Splash! +1' },
  tVoid: { es: '¡Se cae! +1', en: 'Over the edge! +1' },
  tLava: { es: '¡Lava! +1', en: 'Lava! +1' },
  tFlood: { es: '¡La marea! +1', en: 'Caught by the tide! +1' },
  tLip: { es: '¡Uy, por el borde!', en: 'Lipped out!' },
  tLavaRise: { es: 'La lava avanza…', en: 'The lava creeps closer…' },
  tLastStroke: { es: 'Último golpe', en: 'Last stroke' },
  tSway: { es: 'El barco se inclina: tenlo en cuenta', en: 'The deck tilts: aim for it' },
  dailyTitle: { es: 'Reto diario #{n}', en: 'Daily #{n}' },
  dailyAgain: { es: 'Vuelve mañana para el #{n}', en: 'Come back tomorrow for #{n}' },
  dailyPlayed: { es: 'Ya jugado hoy: {s}. Puedes mejorarlo.', en: 'Played today: {s}. You can beat it.' },
  credits: { es: 'Hecho por @nocodeboy', en: 'Made by @nocodeboy' },
  privacyNote: { es: 'Guardamos estadísticas anónimas (desactívalas en Ajustes).', en: 'We collect anonymous stats (turn them off in Settings).' },
  privacyPolicy: { es: 'Política de privacidad', en: 'Privacy policy' },
} satisfies Record<string, Txt>;

export type Key = keyof typeof S;

let lang: Lang = 'en';
export function setLang(l: Lang) {
  lang = l;
  document.documentElement.lang = l;
}
export function getLang(): Lang {
  return lang;
}
/** English first: Spanish only for devices set to Spanish (or Catalan, Galician, Basque). */
export function detectLang(): Lang {
  const n = (navigator.language || 'en').toLowerCase();
  return n.startsWith('es') || n.startsWith('ca') || n.startsWith('gl') || n.startsWith('eu') ? 'es' : 'en';
}
export function t(k: Key, vars?: Record<string, string | number>): string {
  let s: string = S[k][lang];
  if (vars) for (const [a, b] of Object.entries(vars)) s = s.replace(`{${a}}`, String(b));
  return s;
}
export function tx(x: Txt): string {
  return x[lang];
}
export function gameName(): string {
  return lang === 'es' ? '¡Embócala!' : 'Wild Putt';
}
/** Golf name for a score relative to par. */
export function scoreName(strokes: number, par: number, maxed = false): string {
  const d = strokes - par;
  if (maxed) return t('sMaxed', { n: d });
  if (strokes === 1) return t('sHio');
  if (d <= -3) return t('sAlbatross');
  if (d === -2) return t('sEagle');
  if (d === -1) return t('sBirdie');
  if (d === 0) return t('sPar');
  if (d === 1) return t('sBogey');
  if (d === 2) return t('sDouble');
  return t('sOver', { n: d });
}
export function fmtPar(d: number): string {
  return d === 0 ? 'E' : d > 0 ? `+${d}` : `−${-d}`;
}
