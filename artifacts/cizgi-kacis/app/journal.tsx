import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { L, formatCopy, skinName, t } from '@/lib/i18n';
import {
  type Progress,
  SKINS,
  type Skin,
  chapterStars,
  defaultProgress,
  isChapterCompleted,
  isChapterReached,
  secretUnlocked,
  selectSkin,
  skinProgress,
  totalStars,
} from '@/lib/progress';
import { loadProgress, saveProgress } from '@/lib/progressStore';
import { CHAPTERS, chapterById, secretStarTarget } from '@/lib/story';

function requirementText(skin: Skin) {
  const requirement = skin.requirement;
  if (requirement.type === 'dayStreak') return formatCopy('reqDays', { count: String(requirement.target) });
  if (requirement.type === 'stars') return formatCopy('reqStars', { count: String(requirement.target) });
  if (requirement.type === 'perfect') return formatCopy('reqPerfect', { count: String(requirement.target) });
  if (requirement.type === 'chapter') {
    const chapter = chapterById(requirement.chapterId);
    return formatCopy('reqChapter', { chapter: chapter ? L(chapter.name) : '' });
  }
  return '';
}

export default function JournalScreen() {
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

  const chooseSkin = (skinId: string) => {
    const next = selectSkin(progress, skinId);
    setProgress(next);
    void saveProgress(next);
  };

  return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.gameBackground }]} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconButton} accessibilityLabel={t('backToGame')}>
          <Feather name="arrow-left" size={20} color={colors.ink} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>{t('gameName')}</Text>
          <Text style={[styles.title, { color: colors.ink }]}>{t('journal')}</Text>
        </View>
        <Pressable onPress={() => router.push('/leaderboard')} style={styles.iconButton} accessibilityLabel={t('leaderboard')}>
          <Feather name="bar-chart-2" size={18} color={colors.stoneHighlight} />
        </Pressable>
      </View>
      <Text style={[styles.intro, { color: colors.mutedForeground }]}>{t('journalIntro')}</Text>

      <View style={styles.statsGrid}>
        {[
          { icon: 'droplet', value: String(progress.ink), label: t('ink'), color: colors.goal },
          { icon: 'zap', value: String(progress.dayStreak), label: t('dayUnit'), color: colors.stoneHighlight },
          { icon: 'star', value: String(totalStars(progress)), label: t('totalStars'), color: colors.stoneHighlight },
          { icon: 'award', value: String(progress.bestDayStreak), label: t('bestStreak'), color: colors.stone },
        ].map((stat) => (
          <View key={stat.label} style={[styles.statCard, { backgroundColor: colors.gameSurface, borderColor: colors.border }]}>
            <Feather name={stat.icon as 'star'} size={15} color={stat.color} />
            <Text style={[styles.statValue, { color: colors.ink }]}>{stat.value}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{stat.label}</Text>
          </View>
        ))}
      </View>

      <Text style={[styles.sectionTitle, { color: colors.ink }]}>{t('collection')}</Text>
      <View style={styles.skinGrid}>
        {SKINS.map((skin) => {
          const owned = progress.skins.includes(skin.id);
          const selected = progress.selectedSkin === skin.id;
          const { current, target } = skinProgress(progress, skin);
          return (
            <Pressable
              key={skin.id}
              disabled={!owned}
              onPress={() => chooseSkin(skin.id)}
              style={[
                styles.skinCard,
                { backgroundColor: colors.gameSurface, borderColor: selected ? skin.color : colors.border, borderWidth: selected ? 2 : 1, opacity: owned ? 1 : 0.7 },
              ]}
            >
              <View style={[styles.skinOrb, { backgroundColor: owned ? skin.color : colors.border }]}>
                {!owned && <Feather name="lock" size={13} color={colors.gameBackground} />}
              </View>
              <Text style={[styles.skinName, { color: colors.ink }]}>{skinName(skin.id)}</Text>
              {owned ? (
                <Text style={[styles.skinHint, { color: selected ? skin.color : colors.mutedForeground }]}>{selected ? t('selected') : ' '}</Text>
              ) : (
                <>
                  <Text style={[styles.skinHint, { color: colors.mutedForeground }]}>{requirementText(skin)}</Text>
                  <View style={[styles.skinTrack, { backgroundColor: colors.gameSurfaceRaised }]}>
                    <View style={[styles.skinFill, { width: `${Math.round((current / target) * 100)}%`, backgroundColor: skin.color }]} />
                  </View>
                </>
              )}
            </Pressable>
          );
        })}
      </View>

      <Text style={[styles.sectionTitle, { color: colors.ink }]}>{t('storyPages')}</Text>
      {CHAPTERS.map((chapter) => {
        const accent = colors[chapter.accent];
        const reached = isChapterReached(progress, chapter);
        const completed = isChapterCompleted(progress, chapter);
        const missing = Math.max(0, secretStarTarget(chapter) - chapterStars(progress, chapter));
        return (
          <View key={chapter.id} style={[styles.page, { backgroundColor: colors.gameSurface, borderColor: reached ? accent : colors.border, opacity: reached ? 1 : 0.5 }]}>
            <View style={styles.pageHeader}>
              <Feather name={reached ? 'book-open' : 'lock'} size={14} color={reached ? accent : colors.mutedForeground} />
              <Text style={[styles.pageTitle, { color: colors.ink }]}>{L(chapter.name)}</Text>
            </View>
            {!reached ? (
              <Text style={[styles.pageLine, { color: colors.mutedForeground }]}>{t('pageLocked')}</Text>
            ) : (
              <>
                {L(chapter.opening).map((line) => (
                  <Text key={line} style={[styles.pageLine, { color: colors.ink }]}>{line}</Text>
                ))}
                {completed && chapter.ending && L(chapter.ending).map((line) => (
                  <Text key={line} style={[styles.pageLine, { color: colors.mutedForeground }]}>{line}</Text>
                ))}
                {chapter.secret && (
                  secretUnlocked(progress, chapter) ? (
                    <View style={[styles.note, { borderColor: accent, backgroundColor: `${accent}14` }]}>
                      <Feather name="mail" size={13} color={accent} />
                      <Text style={[styles.noteText, { color: colors.ink }]}>{L(chapter.secret)}</Text>
                    </View>
                  ) : (
                    <View style={[styles.note, { borderColor: colors.border }]}>
                      <Feather name="lock" size={13} color={colors.mutedForeground} />
                      <Text style={[styles.noteText, { color: colors.mutedForeground }]}>{formatCopy('secretLocked', { count: String(missing) })}</Text>
                    </View>
                  )
                )}
              </>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 20, paddingTop: 54, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconButton: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#17253A' },
  headerCopy: { flex: 1 },
  eyebrow: { fontSize: 10, letterSpacing: 2, fontWeight: '800' },
  title: { fontSize: 25, fontWeight: '800', marginTop: 4 },
  intro: { fontSize: 13, lineHeight: 20, marginTop: 18, marginBottom: 18 },
  statsGrid: { flexDirection: 'row', gap: 8, marginBottom: 26 },
  statCard: { flex: 1, borderRadius: 14, borderWidth: 1, paddingVertical: 12, alignItems: 'center', gap: 4 },
  statValue: { fontSize: 18, fontWeight: '800' },
  statLabel: { fontSize: 9, fontWeight: '700', textAlign: 'center' },
  sectionTitle: { fontSize: 16, fontWeight: '800', marginBottom: 12 },
  skinGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 28 },
  skinCard: { width: '47.5%', borderRadius: 16, padding: 14, alignItems: 'center' },
  skinOrb: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  skinName: { fontSize: 14, fontWeight: '800', marginTop: 9 },
  skinHint: { fontSize: 10, lineHeight: 14, textAlign: 'center', marginTop: 4, minHeight: 14 },
  skinTrack: { alignSelf: 'stretch', height: 4, borderRadius: 4, overflow: 'hidden', marginTop: 8 },
  skinFill: { height: '100%', borderRadius: 4 },
  page: { borderRadius: 16, borderWidth: 1, padding: 15, marginBottom: 12 },
  pageHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 9 },
  pageTitle: { fontSize: 15, fontWeight: '800' },
  pageLine: { fontSize: 12, lineHeight: 18, marginTop: 4 },
  note: { flexDirection: 'row', gap: 8, borderRadius: 12, borderWidth: 1, padding: 11, marginTop: 12 },
  noteText: { flex: 1, fontSize: 12, lineHeight: 18, fontStyle: 'italic' },
});
