import { Feather } from '@expo/vector-icons';
import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { StoryScene } from '@/components/StoryScene';
import type { useColors } from '@/hooks/useColors';
import { L, t } from '@/lib/i18n';
import type { Chapter } from '@/lib/story';

type Props = {
  kind: 'open' | 'end';
  chapter: Chapter;
  colors: ReturnType<typeof useColors>;
  onDismiss: () => void;
};

const LINE_DELAY = 520;

/** Comic-panel style story overlay. Lines pop in one by one like speech balloons. */
export function StoryCard({ kind, chapter, colors, onDismiss }: Props) {
  const lines = (kind === 'open' ? chapter.opening : chapter.ending ?? chapter.opening);
  const localized = L(lines);
  const accent = colors[chapter.accent];
  const values = useRef(localized.map(() => new Animated.Value(0))).current;
  const panel = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(panel, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    const timers = values.map((value, index) =>
      setTimeout(() => {
        Animated.spring(value, { toValue: 1, damping: 14, stiffness: 190, useNativeDriver: true }).start();
      }, 260 + index * LINE_DELAY),
    );
    return () => timers.forEach(clearTimeout);
  }, [panel, values]);

  return (
    <Animated.View style={[styles.overlay, { backgroundColor: `${colors.gameBackground}F2`, opacity: panel }]}>
      <View style={[styles.panel, { borderColor: accent, backgroundColor: colors.gameSurfaceRaised }]}>
        <View style={styles.kickerRow}>
          <Feather name={kind === 'open' ? 'book-open' : 'bookmark'} size={14} color={accent} />
          <Text style={[styles.kicker, { color: accent }]}>{kind === 'open' ? t('newPage') : t('pageEnd')}</Text>
        </View>
        <Text style={[styles.title, { color: colors.ink }]}>{L(chapter.name)}</Text>
        <View style={[styles.scene, { borderColor: colors.border, backgroundColor: colors.gameSurface }]}>
          <StoryScene
            chapterId={chapter.id}
            kind={kind}
            palette={{
              obstacle: colors.obstacle, stone: colors.stone, stoneHighlight: colors.stoneHighlight, goal: colors.goal,
              gridLine: colors.gridLine, surface: colors.gameSurface, background: colors.gameBackground, border: colors.border,
            }}
          />
        </View>
        <View style={styles.lines}>
          {localized.map((line, index) => (
            <Animated.View
              key={`${chapter.id}-${kind}-${index}`}
              style={[
                styles.balloon,
                {
                  backgroundColor: colors.gameSurface,
                  borderColor: colors.border,
                  opacity: values[index],
                  transform: [
                    { translateY: values[index].interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) },
                    { scale: values[index].interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
                  ],
                },
              ]}
            >
              <Text style={[styles.line, { color: colors.ink }]}>{line}</Text>
            </Animated.View>
          ))}
        </View>
        <Pressable
          testID="story-continue"
          onPress={onDismiss}
          style={({ pressed }) => [styles.button, { backgroundColor: accent, opacity: pressed ? 0.8 : 1 }]}
        >
          <Text style={[styles.buttonText, { color: colors.gameBackground }]}>{t('turnPage')}</Text>
          <Feather name="arrow-right" size={17} color={colors.gameBackground} />
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFill, zIndex: 30, alignItems: 'center', justifyContent: 'center', padding: 18 },
  panel: { width: '100%', borderRadius: 20, borderWidth: 2, padding: 18, alignItems: 'center' },
  kickerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kicker: { fontSize: 10, fontWeight: '800', letterSpacing: 2 },
  title: { fontSize: 24, fontWeight: '800', marginTop: 6, textAlign: 'center' },
  scene: { alignSelf: 'stretch', borderRadius: 14, borderWidth: 1, marginTop: 12, overflow: 'hidden' },
  lines: { alignSelf: 'stretch', gap: 9, marginTop: 12 },
  balloon: { borderRadius: 14, borderWidth: 1, paddingVertical: 10, paddingHorizontal: 13 },
  line: { fontSize: 13, lineHeight: 19, fontWeight: '600' },
  button: { marginTop: 18, borderRadius: 13, paddingVertical: 12, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 8 },
  buttonText: { fontSize: 13, fontWeight: '800' },
});
