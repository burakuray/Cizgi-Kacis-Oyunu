import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { language, t } from '@/lib/i18n';
import type { ScoreEntry } from '@/lib/progress';
import { loadProgress } from '@/lib/progressStore';

export default function LeaderboardScreen() {
  const colors = useColors();
  const router = useRouter();
  const [scores, setScores] = useState<ScoreEntry[]>([]);

  useEffect(() => {
    loadProgress().then((stored) => {
      setScores([...stored.history].sort((left, right) => right.score - left.score).slice(0, 20));
    });
  }, []);

  return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.gameBackground }]} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconButton} accessibilityLabel={t('backToGame')}>
          <Feather name="arrow-left" size={20} color={colors.ink} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>{language === 'en' ? 'LINE MEMORY' : 'ÇİZGİ HAFIZASI'}</Text>
          <Text style={[styles.title, { color: colors.ink }]}>{t('leaderboard')}</Text>
        </View>
        <Feather name="bar-chart-2" size={24} color={colors.stoneHighlight} />
      </View>
      <Text style={[styles.intro, { color: colors.mutedForeground }]}>{language === 'en' ? 'Beat your own shots. Every star leaves a stronger trace.' : 'Kendi atışlarını geride bırak. Her yıldız daha yüksek bir iz bırakır.'}</Text>

      {scores.length === 0 ? (
        <View style={[styles.empty, { backgroundColor: colors.gameSurface }]}>
          <Feather name="crosshair" size={24} color={colors.stoneHighlight} />
          <Text style={[styles.emptyTitle, { color: colors.ink }]}>{language === 'en' ? 'Set your first score' : 'İlk skorunu oluştur'}</Text>
          <Text style={[styles.emptyCopy, { color: colors.mutedForeground }]}>{language === 'en' ? 'Your best shot will appear here after completing a level.' : 'Bir bölümü tamamladığında en iyi atışın burada görünecek.'}</Text>
        </View>
      ) : scores.map((entry, index) => (
        <View key={`${entry.date}-${entry.level}-${index}`} style={[styles.row, { backgroundColor: colors.gameSurface, borderColor: index === 0 ? colors.stoneHighlight : colors.border }]}>
          <Text style={[styles.rank, { color: index < 3 ? colors.stoneHighlight : colors.mutedForeground }]}>{String(index + 1).padStart(2, '0')}</Text>
          <View style={styles.rowMain}>
            <Text style={[styles.rowTitle, { color: colors.ink }]}>{language === 'en' ? 'Level' : 'Bölüm'} {String(entry.level).padStart(2, '0')}</Text>
            <View style={styles.rowMeta}>
              {Array.from({ length: 3 }).map((_, starIndex) => <Feather key={starIndex} name="star" size={11} color={starIndex < entry.stars ? colors.stoneHighlight : colors.border} fill={starIndex < entry.stars ? colors.stoneHighlight : 'transparent'} />)}
              <Text style={[styles.date, { color: colors.mutedForeground }]}>{entry.date}</Text>
            </View>
          </View>
          <Text style={[styles.score, { color: colors.goal }]}>{entry.score}</Text>
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
  intro: { fontSize: 13, lineHeight: 20, marginTop: 20, marginBottom: 24, maxWidth: 300 },
  empty: { borderRadius: 18, padding: 22, alignItems: 'center' },
  emptyTitle: { fontSize: 17, fontWeight: '800', marginTop: 12 },
  emptyCopy: { fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 6, maxWidth: 250 },
  row: { minHeight: 72, borderRadius: 16, borderWidth: 1, paddingHorizontal: 14, marginBottom: 9, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rank: { width: 28, fontSize: 14, fontWeight: '800' },
  rowMain: { flex: 1 },
  rowTitle: { fontSize: 14, fontWeight: '800' },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 6 },
  date: { fontSize: 10, marginLeft: 7 },
  score: { fontSize: 17, fontWeight: '800' },
});
