/**
 * Story data. Kept free of React Native imports so it can be unit-tested with plain Node.
 *
 * Premise: the world is a sketchbook. Nokta (the stone) is the last drop of ink left from
 * the Çizer's (the artist's) final sentence. Silgi (the eraser) is erasing the pages one by one.
 * Reach the EXIT on every page to stay ahead of Silgi and find the Çizer.
 */

export type Lang = 'tr' | 'en';
export type Text2 = { tr: string; en: string };
export type Lines2 = { tr: string[]; en: string[] };
export type Accent = 'obstacle' | 'goal' | 'stoneHighlight';

export type Chapter = {
  id: string;
  start: number;
  /** Last level of the chapter. `null` marks the endless final chapter. */
  end: number | null;
  accent: Accent;
  name: Text2;
  tagline: Text2;
  opening: Lines2;
  ending: Lines2 | null;
  /** The Çizer's note, unlocked by collecting most of the chapter's stars. */
  secret: Text2 | null;
};

export const CHAPTERS: Chapter[] = [
  {
    id: 'first-trace',
    start: 1,
    end: 2,
    accent: 'obstacle',
    name: { tr: 'İlk İz', en: 'First Trace' },
    tagline: { tr: 'Taşın ritmini öğren.', en: 'Learn the stone rhythm.' },
    opening: {
      tr: [
        'Boş bir sayfanın dibinde bir mürekkep damlası uyandı.',
        'Adı Nokta. Çizer’in son cümlesinden geriye kalan tek şey o.',
        'Yukarıda silik bir ışık var: ÇIKIŞ. Oraya bir iz bırakmalı.',
      ],
      en: [
        'At the bottom of a blank page, a drop of ink woke up.',
        'Its name is Dot. It is all that is left of the Artist’s last sentence.',
        'A faint light glows above: EXIT. Dot has to leave a trail there.',
      ],
    },
    ending: {
      tr: [
        'İlk çizgiyi geçtin! Nokta artık bir leke değil, bir yol.',
        'Ama sayfanın köşesinden bir kazıma sesi geliyor. Silgi uyanıyor.',
      ],
      en: [
        'You crossed the first line! Dot is no longer a blot, it is a path.',
        'But a scraping sound comes from the corner of the page. The Eraser is waking up.',
      ],
    },
    secret: {
      tr: '“Bu sayfayı hızlı çizdim. Eğer bunu okuyorsan, Nokta, ilk adımı atmışsın demektir.” — Çizer',
      en: '“I drew this page in a hurry. If you are reading this, Dot, you have taken the first step.” — the Artist',
    },
  },
  {
    id: 'thorn-garden',
    start: 3,
    end: 4,
    accent: 'obstacle',
    name: { tr: 'Diken Bahçesi', en: 'Thorn Garden' },
    tagline: { tr: 'Bariyerlerin arasından süzül.', en: 'Flow between the barriers.' },
    opening: {
      tr: [
        'Çizer sinirlenince karalardı. Bu bahçedeki dikenler o karalamalar.',
        'Silgi bir sayfa arkanda. Durmak yok, ama acele de etme.',
      ],
      en: [
        'The Artist used to scribble when angry. These thorns are those scribbles.',
        'The Eraser is one page behind you. No stopping, but no rushing either.',
      ],
    },
    ending: {
      tr: [
        'Bahçenin sonunda sayfanın kenarında spiral delikler var.',
        'Bir defterin içindesin. Delikler bir yere açılıyor olmalı…',
      ],
      en: [
        'At the end of the garden, spiral holes run along the page edge.',
        'You are inside a notebook. Those holes must lead somewhere…',
      ],
    },
    secret: {
      tr: '“Dikenleri çizerken hep üzgündüm. Ama her diken arasında bir boşluk bıraktım. Bak, bıraktım.” — Çizer',
      en: '“I was always sad when I drew thorns. But I left a gap between every one. Look, I did.” — the Artist',
    },
  },
  {
    id: 'portal-room',
    start: 5,
    end: 8,
    accent: 'goal',
    name: { tr: 'Geçit Odası', en: 'Portal Room' },
    tagline: { tr: 'Kısa yolları keşfet.', en: 'Discover the shortcuts.' },
    opening: {
      tr: [
        'Defter delikleri geçit gibi çalışıyor: birinden gir, diğerinden çık.',
        'Duvarda Çizer’in notu: “Silgiyi atlatmak için sayfa atla.”',
      ],
      en: [
        'The notebook holes work like portals: step into one, leave through the other.',
        'On the wall, the Artist’s note: “To outrun the Eraser, skip a page.”',
      ],
    },
    ending: {
      tr: [
        'Son geçitten çıkarken ufukta kara bir bulut gördün: mürekkep fırtınası.',
        'Çizer’in izi tam içinden geçiyor.',
      ],
      en: [
        'Leaving the last portal, you spot a dark cloud on the horizon: an ink storm.',
        'The Artist’s trail runs right through it.',
      ],
    },
    secret: {
      tr: '“Geçitleri ilk kez çizdiğimde bir kapı olsun istedim. Meğer kaçış yolu çizmişim.” — Çizer',
      en: '“When I first drew the portals, I wanted a door. It turns out I drew an escape route.” — the Artist',
    },
  },
  {
    id: 'storm-corridor',
    start: 9,
    end: 12,
    accent: 'stoneHighlight',
    name: { tr: 'Fırtına Koridoru', en: 'Storm Corridor' },
    tagline: { tr: 'Hareketi doğru zamanda yakala.', en: 'Read the movement.' },
    opening: {
      tr: [
        'Bu fırtına, Çizer’in yarım bıraktığı bir sahne.',
        'Bariyerler nefes alıyor. Ritmi öğren, sonra geç.',
      ],
      en: [
        'This storm is a scene the Artist left unfinished.',
        'The barriers breathe. Learn the rhythm, then pass.',
      ],
    },
    ending: {
      tr: [
        'Fırtınanın ortasında bir kalem ucu parlıyor. Çizer buralarda!',
        'Ama arkanda kocaman, pembe bir gölge büyüyor…',
      ],
      en: [
        'In the middle of the storm, a pencil tip is glowing. The Artist is near!',
        'But behind you, a huge pink shadow is growing…',
      ],
    },
    secret: {
      tr: '“Fırtınayı bitiremedim çünkü sonunu bilmiyordum. Şimdi biliyorum: sonu sensin.” — Çizer',
      en: '“I could not finish the storm because I did not know its ending. Now I do: it is you.” — the Artist',
    },
  },
  {
    id: 'erasers-shadow',
    start: 13,
    end: 16,
    accent: 'obstacle',
    name: { tr: 'Silgi’nin Gölgesi', en: 'The Eraser’s Shadow' },
    tagline: { tr: 'Silinmeden önce ulaş.', en: 'Arrive before you fade.' },
    opening: {
      tr: [
        'Silgi artık seni görüyor. Geçtiğin her sayfa arkandan beyazlıyor.',
        'Çizer’in kalemi çok yakın. Son sprint.',
      ],
      en: [
        'The Eraser can see you now. Every page you cross turns white behind you.',
        'The Artist’s pencil is very close. Final sprint.',
      ],
    },
    ending: {
      tr: [
        'Kalem ucu Nokta’ya değdi. Çizer geri döndü!',
        'Defterin sonu yok: Çizer yeni taslak sayfaları çizmeye başladı…',
      ],
      en: [
        'The pencil tip touched Dot. The Artist is back!',
        'The notebook has no last page: the Artist starts sketching new draft pages…',
      ],
    },
    secret: {
      tr: '“Silgi benim korkumdu, Nokta. Onu sen yendin. Şimdi birlikte çizelim.” — Çizer',
      en: '“The Eraser was my own fear, Dot. You beat it. Now let us draw together.” — the Artist',
    },
  },
  {
    id: 'draft-pages',
    start: 17,
    end: null,
    accent: 'goal',
    name: { tr: 'Taslak Sayfaları', en: 'Draft Pages' },
    tagline: { tr: 'Sonsuz sayfa, sınırsız rekor.', en: 'Endless pages, endless records.' },
    opening: {
      tr: [
        'Çizer her gün yeni taslaklar çiziyor. Her sayfa bir öncekinden cesur.',
        'Rekorlarını kır. Defter seni bekliyor.',
      ],
      en: [
        'The Artist sketches new drafts every day. Each page is bolder than the last.',
        'Break your records. The notebook is waiting.',
      ],
    },
    ending: null,
    secret: null,
  },
];

export function chapterIndexForLevel(level: number): number {
  const safe = Math.max(1, Math.floor(level));
  let found = 0;
  for (let i = 0; i < CHAPTERS.length; i += 1) {
    if (safe >= CHAPTERS[i].start) found = i;
  }
  return found;
}

export function chapterForLevel(level: number): Chapter {
  return CHAPTERS[chapterIndexForLevel(level)];
}

export function chapterById(id: string): Chapter | undefined {
  return CHAPTERS.find((chapter) => chapter.id === id);
}

export function isChapterStart(level: number): boolean {
  return CHAPTERS.some((chapter) => chapter.start === level);
}

export function isChapterEnd(level: number): boolean {
  return CHAPTERS.some((chapter) => chapter.end === level);
}

/** Levels that belong to a chapter. The endless chapter lists `minimumVisible` levels at least. */
export function chapterLevels(chapter: Chapter, minimumVisible = 4): number[] {
  const end = chapter.end ?? chapter.start + minimumVisible - 1;
  return Array.from({ length: end - chapter.start + 1 }, (_, index) => chapter.start + index);
}

/** Highest star total a finite chapter can give. */
export function chapterMaxStars(chapter: Chapter): number {
  return chapter.end === null ? 0 : (chapter.end - chapter.start + 1) * 3;
}

/** Stars needed to unlock the Çizer's note: 80% of the chapter maximum, rounded up. */
export function secretStarTarget(chapter: Chapter): number {
  return Math.ceil(chapterMaxStars(chapter) * 0.8);
}

/** How many levels remain until the current chapter is finished. */
export function levelsUntilChapterEnd(level: number): number | null {
  const chapter = chapterForLevel(level);
  return chapter.end === null ? null : chapter.end - level;
}
