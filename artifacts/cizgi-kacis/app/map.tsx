import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { L, formatCopy, t } from '@/lib/i18n';
import {
  type Progress,
  chapterStars,
  defaultProgress,
  isChapterCompleted,
  isChapterReached,
  secretUnlocked,
  totalStars,
} from '@/lib/progress';
import { loadProgress } from '@/lib/progressStore';
import { CHAPTERS, chapterLevels, chapterMaxStars } from '@/lib/story';

export default function MapScreen() {
  const colors = useColors();
  const router = useRouter();
  const [progress, setProgress] = useState<Progress>(defaultProgress);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      loadProgress().then((stored) => {
        if (active) setProgress(stored);
      });
      return () => {
        active = false;
      };
    }, []),
  );

  const openLevel = (level: number) => router.replace({ pathname: '/', params: { level: String(level), t: String(Date.now()) } });

  return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.gameBackground }]} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconButton} accessibilityLabel={t('backToGame')}>
          <Feather name="arrow-left" size={20} color={colors.ink} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>{t('journal').toUpperCase()}</Text>
          <Text style={[styles.title, { color: colors.ink }]}>{t('map')}</Text>
        </View>
        <View style={[styles.totalBadge, { backgroundColor: colors.gameSurfaceRaised }]}>
          <Feather name="star" size={14} color={colors.stoneHighlight} />
          <Text style={[styles.totalText, { color: colors.stoneHighlight }]}>{totalStars(progress)}</Text>
        </View>
      </View>

      <Pressable
        testID="continue-journey"
        onPress={() => openLevel(progress.bestLevel)}
        style={({ pressed }) => [styles.continueButton, { backgroundColor: colors.goal, opacity: pressed ? 0.85 : 1 }]}
      >
        <View style={styles.continueCopy}>
          <Text style={[styles.continueLabel, { color: colors.gameBackground }]}>{t('continueJourney')}</Text>
          <Text style={[styles.continueLevel, { color: colors.gameBackground }]}>
            {t('section')} {String(progress.bestLevel).padStart(2, '0')}
          </Text>
        </View>
        <Feather name="play" size={20} color={colors.gameBackground} />
      </Pressable>

      {CHAPTERS.map((chapter) => {
        const accent = colors[chapter.accent];
        const reached = isChapterReached(progress, chapter);
        const completed = isChapterCompleted(progress, chapter);
        const max = chapterMaxStars(chapter);
        const visible = chapter.end === null ? Math.max(4, progress.bestLevel - chapter.start + 2) : 4;
        return (
          <View key={chapter.id} style={[styles.chapterBlock, { opacity: reached ? 1 : 0.55 }]}>
            <View style={styles.chapterHeading}>
              <View style={[styles.chapterDot, { backgroundColor: completed ? accent : reached ? colors.stoneHighlight : colors.border }]} />
              <View style={styles.chapterHeadingCopy}>
                <Text style={[styles.chapterTitle, { color: colors.ink }]}>{L(chapter.name)}</Text>
                <Text style={[styles.chapterCopy, { color: colors.mutedForeground }]}>{L(chapter.tagline)}</Text>
              </View>
              {max > 0 && (
                <View style={styles.chapterStars}>
                  <Feather name="star" size={11} color={colors.stoneHighlight} />
                  <Text style={[styles.chapterStarsText, { color: colors.mutedForeground }]}>{chapterStars(progress, chapter)}/{max}</Text>
                  {secretUnlocked(progress, chapter) && <Feather name="mail" size={11} color={accent} />}
                </View>
              )}
            </View>
            <View style={styles.levelGrid}>
              {chapterLevels(chapter, visible).map((level) => {
                const unlocked = level <= progress.bestLevel;
                const current = level === progress.currentLevel;
                const levelStars = progress.stars[String(level)] ?? 0;
                return (
                  <Pressable
                    key={level}
                    disabled={!unlocked}
                    onPress={() => openLevel(level)}
                    accessibilityLabel={formatCopy('dailyProgress', { count: String(levelStars), target: '3' })}
                    style={[
                      styles.levelNode,
                      {
                        backgroundColor: unlocked ? colors.gameSurface : colors.gameSurfaceRaised,
                        borderColor: current ? colors.stoneHighlight : unlocked ? colors.border : colors.gameSurfaceRaised,
                        borderWidth: current ? 2 : 1,
                        opacity: unlocked ? 1 : 0.45,
                      },
                    ]}
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
        );
      })}
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
  continueButton: { marginTop: 22, marginBottom: 26, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  continueCopy: { flex: 1 },
  continueLabel: { fontSize: 12, fontWeight: '700', opacity: 0.8 },
  continueLevel: { fontSize: 20, fontWeight: '800', marginTop: 2 },
  chapterBlock: { marginBottom: 28 },
  chapterHeading: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  chapterHeadingCopy: { flex: 1 },
  chapterDot: { width: 10, height: 10, borderRadius: 5 },
  chapterTitle: { fontSize: 16, fontWeight: '800' },
  chapterCopy: { fontSize: 11, marginTop: 3 },
  chapterStars: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  chapterStarsText: { fontSize: 11, fontWeight: '700' },
  levelGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  levelNode: { width: 72, height: 76, borderRadius: 16, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  levelNumber: { fontSize: 20, fontWeight: '800' },
  stars: { flexDirection: 'row', gap: 2, marginTop: 6 },
  lock: { position: 'absolute', right: 8, top: 8 },
});
