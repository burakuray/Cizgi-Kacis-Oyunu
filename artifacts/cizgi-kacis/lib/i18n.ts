import { getLocales } from 'expo-localization';

export type Language = 'tr' | 'en';

const deviceLanguage = getLocales()[0]?.languageCode?.toLowerCase();
export const language: Language = deviceLanguage?.startsWith('en') ? 'en' : 'tr';

const copy = {
  tr: {
    gameName: 'ÇİZGİ KAÇIŞ',
    title: 'Temiz bir yol bul.',
    section: 'BÖLÜM',
    attempts: 'atış',
    best: 'en iyi',
    streak: 'seri',
    score: 'puan',
    moving: 'taş hareket ediyor',
    drag: 'sürükle ve bırak',
    power: 'GÜÇ',
    direction: 'YÖN',
    newScene: 'YENİ SAHNE',
    chapter: 'BÖLÜM',
    exit: 'ÇIKIŞ',
    help: 'Ekranda istediğin yere dokun, sürükle ve bırak',
    hitTitle: 'Çizgiye değdin',
    hitCopy: 'Taş başlangıca döndü. Biraz daha dikkatli bir açı dene.',
    retry: 'Yeniden dene',
    successTitle: 'Temiz geçiş',
    nextCopy: 'Sırada {chapter} var. Hazır mısın?',
    next: 'Sonraki bölüm',
    completed: 'Bölüm tamamlandı',
    daily: 'günlük',
    stars: 'yıldız',
    style: 'stil',
    obstacle: 'engel',
    goal: 'çıkış',
    movingObstacle: 'hareketli',
    portal: 'geçit',
    soundOn: 'Sesleri kapat',
    soundOff: 'Sesleri aç',
    map: 'Bölüm haritası',
    leaderboard: 'Skor tablosu',
    lives: 'HAK',
    livesLeft: '{count} hak kaldı',
    demotedTitle: 'Bir önceki bölüme döndün',
    demotedCopy: 'Bölüm {level} seni bekliyor. Üç yeni hak kazandın.',
    continue: 'Devam et',
    gameOverTitle: 'Oyun sona erdi',
    gameOverCopy: 'Tekrar başlamak ister misin?',
    restart: 'Yeniden başla',
  },
  en: {
    gameName: 'LINE ESCAPE',
    title: 'Find a clean path.',
    section: 'LEVEL',
    attempts: 'shots',
    best: 'best',
    streak: 'streak',
    score: 'score',
    moving: 'stone is moving',
    drag: 'drag and release',
    power: 'POWER',
    direction: 'AIM',
    newScene: 'NEW SCENE',
    chapter: 'LEVEL',
    exit: 'EXIT',
    help: 'Touch the screen, drag, and release',
    hitTitle: 'You hit the line',
    hitCopy: 'The stone returned to the start. Try a more careful angle.',
    retry: 'Try again',
    successTitle: 'Clean passage',
    nextCopy: 'Next up: {chapter}. Ready?',
    next: 'Next level',
    completed: 'Level complete',
    daily: 'daily',
    stars: 'stars',
    style: 'style',
    obstacle: 'obstacle',
    goal: 'exit',
    movingObstacle: 'moving',
    portal: 'portal',
    soundOn: 'Mute sounds',
    soundOff: 'Enable sounds',
    map: 'Level map',
    leaderboard: 'Leaderboard',
    lives: 'LIVES',
    livesLeft: '{count} lives left',
    demotedTitle: 'Back to the previous level',
    demotedCopy: 'Level {level} is waiting. You have three fresh lives.',
    continue: 'Continue',
    gameOverTitle: 'Game over',
    gameOverCopy: 'Would you like to play again?',
    restart: 'Restart',
  },
} as const;

export type CopyKey = keyof typeof copy.tr;

export function t(key: CopyKey) {
  return copy[language][key];
}

export function formatCopy(key: CopyKey, values: Record<string, string>) {
  return Object.entries(values).reduce<string>((text, [name, value]) => text.replace(`{${name}}`, value), t(key));
}

export function chapterName(level: number) {
  if (language === 'en') {
    if (level >= 9) return 'Storm Corridor';
    if (level >= 5) return 'Portal Room';
    if (level >= 3) return 'Thorn Garden';
    return 'First Trace';
  }
  if (level >= 9) return 'Fırtına Koridoru';
  if (level >= 5) return 'Geçit Odası';
  if (level >= 3) return 'Diken Bahçesi';
  return 'İlk İz';
}
