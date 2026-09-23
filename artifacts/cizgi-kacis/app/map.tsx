import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { chapterName, language, t } from '@/lib/i18n';

const BEST_LEVEL_KEY = '@cizgi-kacis/best-level';
const LEVEL_STARS_KEY = '@cizgi-kacis/level-stars';

const chapters = [
  { start: 1, end: 2, copy: language === 'en' ? 'Learn the stone rhythm.' : 'Taşın ritmini öğren.' },
  { start: 3, end: 4, copy: language === 'en' ? 'Flow between the barriers.' : 'Bariyerlerin arasından süzül.' },
  { start: 5, end: 8, copy: language === 'en' ? 'Discover the shortcuts.' : 'Kısa yolları keşfet.' },
  { start: 9, end: 12, copy: language === 'en' ? 'Read the movement.' : 'Hareketi doğru zamanda yakala.' },
];

function readStars(value: string | null): Record<string, number> {
  if (!value) return {};
  try {
    return JSON.parse(value) as Record<string, number>;
  } catch {
    return {};
  }
}

export default function MapScreen() {
  const colors = useColors();
  const router = useRouter();
  const [bestLevel, setBestLevel] = useState(1);
  const [stars, setStars] = useState<Record<string, number>>({});

  useEffect(() => {
    Promise.all([AsyncStorage.getItem(BEST_LEVEL_KEY), AsyncStorage.getItem(LEVEL_STARS_KEY)]).then(([storedBest, storedStars]) => {
      setBestLevel(Math.max(1, Number(storedBest ?? 1)));
      setStars(readStars(storedStars));
    });
  }, []);

  return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.gameBackground }]} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconButton} accessibilityLabel="Oyuna dön">
          <Feather name="arrow-left" size={20} color={colors.ink} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>{language === 'en' ? 'JOURNEY' : 'YOLCULUK'}</Text>
          <Text style={[styles.title, { color: colors.ink }]}>{t('map')}</Text>
        </View>
        <View style={[styles.totalBadge, { backgroundColor: colors.gameSurfaceRaised }]}>
          <Feather name="star" size={14} color={colors.stoneHighlight} />
          <Text style={[styles.totalText, { color: colors.stoneHighlight }]}>{Object.values(stars).reduce((sum, value) => sum + value, 0)}</Text>
        </View>
      </View>

      <Text style={[styles.intro, { color: colors.mutedForeground }]}>{language === 'en' ? 'Rediscover the scenes you opened in the memory of the line.' : 'Çizginin hafızasında açtığın sahneleri yeniden keşfet.'}</Text>

      {chapters.map((chapter, chapterIndex) => (
        <View key={chapter.start} style={styles.chapterBlock}>
          <View style={styles.chapterHeading}>
            <View style={[styles.chapterDot, { backgroundColor: chapterIndex <= 1 ? colors.goal : colors.border }]} />
            <View>
              <Text style={[styles.chapterTitle, { color: colors.ink }]}>{chapterName(chapter.start)}</Text>
              <Text style={[styles.chapterCopy, { color: colors.mutedForeground }]}>{chapter.copy}</Text>
            </View>
          </View>
          <View style={styles.levelGrid}>
            {Array.from({ length: chapter.end - chapter.start + 1 }).map((_, index) => {
              const level = chapter.start + index;
              const unlocked = level <= bestLevel;
              const levelStars = stars[String(level)] ?? 0;
              return (
                <Pressable
                  key={level}
                  disabled={!unlocked}
                  onPress={() => router.replace({ pathname: '/', params: { level: String(level) } })}
                  style={[styles.levelNode, { backgroundColor: unlocked ? colors.gameSurface : colors.gameSurfaceRaised, borderColor: unlocked ? colors.border : colors.gameSurfaceRaised, opacity: unlocked ? 1 : 0.45 }]}
                >
                  <Text style={[styles.levelNumber, { color: unlocked ? colors.ink : colors.mutedForeground }]}>{String(level).padStart(2, '0')}</Text>
                  <View style={styles.stars}>
                    {Array.from({ length: 3 }).map((__, starIndex) => (
                      <Feather key={starIndex} name="star" size={10} color={starIndex < levelStars ? colors.stoneHighlight : colors.border} fill={starIndex < levelStars ? colors.stoneHighlight : 'transparent'} />
                    ))}
                  </View>
                  {!unlocked && <Feather name="lock" size={13} color={colors.mutedForeground} style={styles.lock} />}
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 20, paddingTop: 54, paddingBottom: 36 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconButton: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#17253A' },
  headerCopy: { flex: 1 },
  eyebrow: { fontSize: 10, letterSpacing: 2, fontWeight: '800' },
  title: { fontSize: 25, fontWeight: '800', marginTop: 4 },
  totalBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 9 },
  totalText: { fontSize: 15, fontWeight: '800' },
  intro: { fontSize: 13, lineHeight: 20, marginTop: 20, marginBottom: 26, maxWidth: 290 },
  chapterBlock: { marginBottom: 28 },
  chapterHeading: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  chapterDot: { width: 10, height: 10, borderRadius: 5 },
  chapterTitle: { fontSize: 16, fontWeight: '800' },
  chapterCopy: { fontSize: 11, marginTop: 3 },
  levelGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  levelNode: { width: 72, height: 76, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  levelNumber: { fontSize: 20, fontWeight: '800' },
  stars: { flexDirection: 'row', gap: 2, marginTop: 6 },
  lock: { position: 'absolute', right: 8, top: 8 },
});
