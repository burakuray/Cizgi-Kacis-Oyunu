import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { type CopyKey, formatCopy, language, t } from '@/lib/i18n';
import { type Account, ApiError, type Board, type LeaderboardEntry } from '@/lib/leaderboardApi';
import { clearAccount, joinLeaderboard, leaderboardClient, loadAccount, saveAccount, syncScore } from '@/lib/leaderboardSync';
import { type Progress, type ScoreEntry, defaultProgress, totalScore } from '@/lib/progress';
import { loadProgress } from '@/lib/progressStore';

type Status = 'loading' | 'ready' | 'error' | 'unconfigured';
const MEDALS = ['#F5C451', '#C9D1DC', '#D79A6A'];

/** Turns a server or network failure into a sentence the player understands. */
function describeError(error: unknown): string {
  if (!(error instanceof ApiError)) return t('lbErrGeneric');
  if (error.code === 'invalid_nickname') {
    const key: CopyKey = error.reason === 'length' ? 'lbErrLength' : error.reason === 'reserved' ? 'lbErrReserved' : 'lbErrChars';
    return t(key);
  }
  if (error.code === 'rate_limited') return t('lbRateLimited');
  if (error.code === 'network' || error.code === 'timeout') return t('lbOffline');
  if (error.code === 'unavailable' || error.code === 'server_error') return t('lbUnavailable');
  return t('lbErrGeneric');
}

function Row({ entry, colors }: { entry: LeaderboardEntry; colors: ReturnType<typeof useColors> }) {
  const medal = entry.rank <= 3 ? MEDALS[entry.rank - 1] : null;
  return (
    <View
      style={[
        styles.row,
        { backgroundColor: entry.isMe ? `${colors.goal}18` : colors.gameSurface, borderColor: entry.isMe ? colors.goal : medal ?? colors.border },
      ]}
      accessibilityLabel={`${entry.rank}. ${entry.nickname}, ${entry.score} ${t('lbPoints')}`}
    >
      <View style={styles.rankCell}>
        {medal ? <Feather name="award" size={18} color={medal} /> : null}
        <Text style={[styles.rank, { color: medal ?? colors.mutedForeground }]}>{entry.rank}</Text>
      </View>
      <View style={styles.rowMain}>
        <Text style={[styles.rowTitle, { color: colors.ink }]} numberOfLines={1}>
          {entry.nickname}
          {entry.isMe ? `  ·  ${t('lbYou')}` : ''}
        </Text>
        <View style={styles.rowMeta}>
          <Feather name="star" size={11} color={colors.stoneHighlight} />
          <Text style={[styles.date, { color: colors.mutedForeground }]}>{entry.stars}</Text>
          <Text style={[styles.date, { color: colors.mutedForeground }]}>· {language === 'en' ? 'Level' : 'Bölüm'} {entry.levelsCleared}</Text>
        </View>
      </View>
      <Text style={[styles.score, { color: colors.goal }]}>{entry.score}</Text>
    </View>
  );
}

export default function LeaderboardScreen() {
  const colors = useColors();
  const router = useRouter();
  const [progress, setProgress] = useState<Progress>(defaultProgress);
  const [account, setAccount] = useState<Account | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [loadError, setLoadError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [nickname, setNickname] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);

  const load = useCallback(async () => {
    const stored = await loadProgress();
    setProgress(stored);
    const client = leaderboardClient();
    if (!client) {
      setStatus('unconfigured');
      return;
    }
    if (await loadAccount()) await syncScore(stored); // upload the latest total first so the ranking is current
    const current = await loadAccount(); // the server may have forgotten this account
    setAccount(current);
    try {
      setBoard(await client.board(50, current ?? undefined));
      setLoadError(null);
      setStatus('ready');
    } catch (error) {
      setLoadError(error);
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const join = async () => {
    setBusy(true);
    setFormError(null);
    try {
      const { account: created } = await joinLeaderboard(nickname, progress);
      setAccount(created);
      setNickname('');
      await load();
    } catch (error) {
      setFormError(describeError(error));
    } finally {
      setBusy(false);
    }
  };

  const rename = async () => {
    const client = leaderboardClient();
    if (!client || !account) return;
    setBusy(true);
    setFormError(null);
    try {
      const { nickname: saved } = await client.rename(account, nickname);
      const updated = { ...account, nickname: saved };
      await saveAccount(updated);
      setAccount(updated);
      setRenaming(false);
      setNickname('');
      await load();
    } catch (error) {
      setFormError(describeError(error));
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    Alert.alert(t('lbDelete'), t('lbDeleteConfirm'), [
      { text: t('lbCancel'), style: 'cancel' },
      {
        text: t('lbDeleteYes'),
        style: 'destructive',
        onPress: async () => {
          const client = leaderboardClient();
          try {
            if (client && account) await client.deleteAccount(account);
          } catch (error) {
            if (!(error instanceof ApiError) || error.code !== 'unauthorized') {
              setFormError(describeError(error));
              return;
            }
          }
          await clearAccount();
          setAccount(null);
          setRenaming(false);
          await load();
        },
      },
    ]);
  };

  const scores: ScoreEntry[] = [...progress.history].sort((left, right) => right.score - left.score).slice(0, 20);
  const me = board?.me ?? null;
  const showAround = me !== null && board !== null && board.around.length > 0 && !board.entries.some((entry) => entry.isMe);

  const nicknameForm = (onSubmit: () => void, label: string) => (
    <View style={styles.form}>
      <Text style={[styles.formLabel, { color: colors.mutedForeground }]}>{t('lbNicknameLabel')}</Text>
      <TextInput
        testID="nickname-input"
        value={nickname}
        onChangeText={(text) => {
          setNickname(text);
          setFormError(null);
        }}
        placeholder={t('lbNicknameHint')}
        placeholderTextColor={colors.mutedForeground}
        maxLength={16}
        autoCapitalize="words"
        autoCorrect={false}
        style={[styles.input, { color: colors.ink, borderColor: formError ? colors.obstacle : colors.border, backgroundColor: colors.gameSurface }]}
      />
      {formError ? <Text style={[styles.formError, { color: colors.obstacle }]}>{formError}</Text> : null}
      <Pressable
        testID="nickname-submit"
        disabled={busy || nickname.trim().length < 3}
        onPress={onSubmit}
        style={({ pressed }) => [styles.primaryButton, { backgroundColor: colors.goal, opacity: busy || nickname.trim().length < 3 ? 0.45 : pressed ? 0.85 : 1 }]}
      >
        {busy ? <ActivityIndicator color={colors.gameBackground} /> : <Text style={[styles.primaryText, { color: colors.gameBackground }]}>{label}</Text>}
      </Pressable>
    </View>
  );

  return (
    <ScrollView
      style={[styles.screen, { backgroundColor: colors.gameBackground }]}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.goal} />}
    >
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} style={styles.iconButton} accessibilityLabel={t('backToGame')}>
          <Feather name="arrow-left" size={20} color={colors.ink} />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>{t('gameName')}</Text>
          <Text style={[styles.title, { color: colors.ink }]}>{t('lbTitle')}</Text>
        </View>
        <Pressable onPress={refresh} style={styles.iconButton} accessibilityLabel={t('lbRefresh')}>
          <Feather name="refresh-cw" size={18} color={colors.stoneHighlight} />
        </Pressable>
      </View>

      {status === 'unconfigured' && <Text style={[styles.notice, { color: colors.mutedForeground, borderColor: colors.border }]}>{t('lbNotConfigured')}</Text>}

      {status !== 'unconfigured' && account === null && (
        <View style={[styles.card, { backgroundColor: colors.gameSurface, borderColor: colors.goal }]}>
          <View style={styles.cardHeader}>
            <Feather name="users" size={18} color={colors.goal} />
            <Text style={[styles.cardTitle, { color: colors.ink }]}>{t('lbJoinTitle')}</Text>
          </View>
          <Text style={[styles.cardCopy, { color: colors.mutedForeground }]}>{t('lbJoinCopy')}</Text>
          {nicknameForm(join, busy ? t('lbJoining') : t('lbJoin'))}
        </View>
      )}

      {account !== null && (
        <View style={[styles.card, { backgroundColor: colors.gameSurface, borderColor: colors.goal }]}>
          <Text style={[styles.cardKicker, { color: colors.goal }]}>{t('lbYourRank').toUpperCase()}</Text>
          <View style={styles.meRow}>
            <Text style={[styles.meRank, { color: colors.ink }]}>{me ? `#${me.rank}` : '—'}</Text>
            <View style={styles.meCopy}>
              <Text style={[styles.meName, { color: colors.ink }]} numberOfLines={1}>{account.nickname}</Text>
              <Text style={[styles.cardCopy, { color: colors.mutedForeground, marginTop: 2 }]}>
                {board ? formatCopy('lbOfPlayers', { total: String(board.total) }) : ' '}
              </Text>
            </View>
            <View style={styles.meScore}>
              <Text style={[styles.score, { color: colors.goal }]}>{me ? me.score : totalScore(progress)}</Text>
              <Text style={[styles.date, { color: colors.mutedForeground, marginLeft: 0 }]}>{t('lbPoints')}</Text>
            </View>
          </View>
          {renaming ? (
            <>
              {nicknameForm(rename, t('lbSave'))}
              <Pressable
                onPress={() => {
                  setRenaming(false);
                  setNickname('');
                  setFormError(null);
                }}
                style={styles.linkButton}
              >
                <Text style={[styles.linkText, { color: colors.mutedForeground }]}>{t('lbCancel')}</Text>
              </Pressable>
            </>
          ) : (
            <View style={styles.accountActions}>
              <Pressable
                onPress={() => {
                  setRenaming(true);
                  setNickname(account.nickname);
                }}
                style={styles.linkButton}
              >
                <Feather name="edit-2" size={13} color={colors.stoneHighlight} />
                <Text style={[styles.linkText, { color: colors.stoneHighlight }]}>{t('lbRename')}</Text>
              </Pressable>
              <Pressable onPress={remove} style={styles.linkButton}>
                <Feather name="trash-2" size={13} color={colors.mutedForeground} />
                <Text style={[styles.linkText, { color: colors.mutedForeground }]}>{t('lbDelete')}</Text>
              </Pressable>
            </View>
          )}
          {formError && !renaming ? <Text style={[styles.formError, { color: colors.obstacle }]}>{formError}</Text> : null}
        </View>
      )}

      {status === 'loading' && (
        <View style={styles.center}>
          <ActivityIndicator color={colors.goal} />
          <Text style={[styles.cardCopy, { color: colors.mutedForeground }]}>{t('lbLoading')}</Text>
        </View>
      )}

      {status === 'error' && (
        <View style={[styles.card, { backgroundColor: colors.gameSurface, borderColor: colors.border }]}>
          <Text style={[styles.cardCopy, { color: colors.ink }]}>{describeError(loadError)}</Text>
          <Pressable onPress={refresh} style={styles.linkButton}>
            <Feather name="refresh-cw" size={13} color={colors.stoneHighlight} />
            <Text style={[styles.linkText, { color: colors.stoneHighlight }]}>{t('lbRetry')}</Text>
          </Pressable>
        </View>
      )}

      {status === 'ready' && board !== null && (
        <>
          {board.entries.length === 0 ? (
            <Text style={[styles.notice, { color: colors.mutedForeground, borderColor: colors.border }]}>{t('lbEmpty')}</Text>
          ) : (
            board.entries.map((entry) => <Row key={`top-${entry.rank}`} entry={entry} colors={colors} />)
          )}
          {showAround && (
            <>
              <Text style={[styles.gap, { color: colors.mutedForeground }]}>⋮</Text>
              {board.around.map((entry) => <Row key={`around-${entry.rank}`} entry={entry} colors={colors} />)}
            </>
          )}
        </>
      )}

      <Text style={[styles.sectionTitle, { color: colors.ink }]}>{t('lbLocal')}</Text>
      {scores.length === 0 ? (
        <Text style={[styles.notice, { color: colors.mutedForeground, borderColor: colors.border }]}>
          {language === 'en' ? 'Your best shot will appear here after completing a level.' : 'Bir bölümü tamamladığında en iyi atışın burada görünecek.'}
        </Text>
      ) : (
        scores.map((entry, index) => (
          <View key={`${entry.date}-${entry.level}-${index}`} style={[styles.row, { backgroundColor: colors.gameSurface, borderColor: index === 0 ? colors.stoneHighlight : colors.border }]}>
            <Text style={[styles.rank, { width: 28, color: index < 3 ? colors.stoneHighlight : colors.mutedForeground }]}>{String(index + 1).padStart(2, '0')}</Text>
            <View style={styles.rowMain}>
              <Text style={[styles.rowTitle, { color: colors.ink }]}>{language === 'en' ? 'Level' : 'Bölüm'} {String(entry.level).padStart(2, '0')}</Text>
              <View style={styles.rowMeta}>
                {Array.from({ length: 3 }).map((_, starIndex) => <Feather key={starIndex} name="star" size={11} color={starIndex < entry.stars ? colors.stoneHighlight : colors.border} fill={starIndex < entry.stars ? colors.stoneHighlight : 'transparent'} />)}
                <Text style={[styles.date, { color: colors.mutedForeground }]}>{entry.date}</Text>
              </View>
            </View>
            <Text style={[styles.score, { color: colors.goal }]}>{entry.score}</Text>
          </View>
        ))
      )}
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
  rank: { fontSize: 14, fontWeight: '800' },
  rowMain: { flex: 1 },
  rowTitle: { fontSize: 14, fontWeight: '800' },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 6 },
  date: { fontSize: 10, marginLeft: 7 },
  score: { fontSize: 17, fontWeight: '800' },
  notice: { borderWidth: 1, borderStyle: 'dashed', borderRadius: 14, padding: 14, fontSize: 12, lineHeight: 18, marginBottom: 14 },
  card: { borderRadius: 18, borderWidth: 1, padding: 16, marginTop: 20, marginBottom: 16 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardTitle: { fontSize: 16, fontWeight: '800' },
  cardKicker: { fontSize: 10, fontWeight: '800', letterSpacing: 1.8 },
  cardCopy: { fontSize: 12, lineHeight: 18, marginTop: 6 },
  form: { marginTop: 12 },
  formLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 13, paddingVertical: 11, fontSize: 15, fontWeight: '600' },
  formError: { fontSize: 12, marginTop: 8 },
  primaryButton: { borderRadius: 12, paddingVertical: 13, alignItems: 'center', marginTop: 12 },
  primaryText: { fontSize: 14, fontWeight: '800' },
  meRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 8 },
  meRank: { fontSize: 34, fontWeight: '900' },
  meCopy: { flex: 1 },
  meName: { fontSize: 15, fontWeight: '800' },
  meScore: { alignItems: 'flex-end' },
  accountActions: { flexDirection: 'row', gap: 18, marginTop: 14 },
  linkButton: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, marginTop: 6 },
  linkText: { fontSize: 12, fontWeight: '700' },
  center: { alignItems: 'center', gap: 10, paddingVertical: 28 },
  gap: { textAlign: 'center', fontSize: 18, marginBottom: 9 },
  sectionTitle: { fontSize: 16, fontWeight: '800', marginTop: 26, marginBottom: 12 },
  rankCell: { width: 40, flexDirection: 'row', alignItems: 'center', gap: 4 },
});
