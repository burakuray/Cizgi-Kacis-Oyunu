import AsyncStorage from '@react-native-async-storage/async-storage';
import { type Account, ApiError, type LeaderboardClient, type ScoreResult, createLeaderboardClient } from './leaderboardApi.ts';
import { type Progress, leaderboardSnapshot } from './progress.ts';

const ACCOUNT_KEY = '@cizgi-kacis/leaderboard-account';
const STATE_KEY = '@cizgi-kacis/leaderboard-state';

/** Where the API lives: EXPO_PUBLIC_API_URL, or the project's public domain (Replit sets EXPO_PUBLIC_DOMAIN). */
export function apiBaseUrl(): string | null {
  const explicit = process.env.EXPO_PUBLIC_API_URL;
  if (explicit) return `${explicit.replace(/\/+$/, '')}/api`;
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  return domain ? `https://${domain}/api` : null;
}

let cachedClient: LeaderboardClient | null | undefined;
export function leaderboardClient(): LeaderboardClient | null {
  if (cachedClient === undefined) {
    const base = apiBaseUrl();
    cachedClient = base ? createLeaderboardClient({ baseUrl: base }) : null;
  }
  return cachedClient;
}

export type SyncState = { lastScore: number; rank: number | null; total: number | null };

export async function loadAccount(): Promise<Account | null> {
  try {
    const raw = await AsyncStorage.getItem(ACCOUNT_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed.id === 'string' && typeof parsed.secret === 'string' && typeof parsed.nickname === 'string' ? (parsed as Account) : null;
  } catch {
    return null;
  }
}

export async function saveAccount(account: Account): Promise<void> {
  await AsyncStorage.setItem(ACCOUNT_KEY, JSON.stringify(account));
}

export async function clearAccount(): Promise<void> {
  await AsyncStorage.multiRemove([ACCOUNT_KEY, STATE_KEY]);
}

export async function loadSyncState(): Promise<SyncState> {
  try {
    const raw = await AsyncStorage.getItem(STATE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed.lastScore === 'number') return parsed as SyncState;
  } catch {
    // fall through
  }
  return { lastScore: -1, rank: null, total: null };
}

async function saveSyncState(state: SyncState): Promise<void> {
  try {
    await AsyncStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    // best effort
  }
}

export type SyncOutcome =
  | { status: 'ok'; result: ScoreResult; previousRank: number | null }
  | { status: 'unchanged'; rank: number | null; total: number | null }
  | { status: 'no-account' | 'unconfigured' }
  | { status: 'error'; error: ApiError };

let inFlight: Promise<SyncOutcome> | null = null;
let queued: { progress: Progress; force: boolean } | null = null;

/**
 * Sends the player's total to the world leaderboard. Safe to call after every clear: it skips when nothing
 * changed, never runs two uploads at once (the latest progress wins), and a failure is simply retried by the
 * next call because every upload carries the whole total.
 */
export function syncScore(progress: Progress, options: { force?: boolean } = {}): Promise<SyncOutcome> {
  if (inFlight) {
    queued = { progress, force: options.force === true };
    return inFlight;
  }
  inFlight = (async (): Promise<SyncOutcome> => {
    try {
      return await run(progress, options.force === true);
    } finally {
      inFlight = null;
      if (queued) {
        const next = queued;
        queued = null;
        void syncScore(next.progress, { force: next.force });
      }
    }
  })();
  return inFlight;
}

async function run(progress: Progress, force: boolean): Promise<SyncOutcome> {
  const client = leaderboardClient();
  if (!client) return { status: 'unconfigured' };
  const account = await loadAccount();
  if (!account) return { status: 'no-account' };
  const snapshot = leaderboardSnapshot(progress);
  const state = await loadSyncState();
  if (!force && snapshot.score === state.lastScore) return { status: 'unchanged', rank: state.rank, total: state.total };
  try {
    const result = await client.submitScore(account, snapshot);
    await saveSyncState({ lastScore: snapshot.score, rank: result.rank, total: result.total });
    return { status: 'ok', result, previousRank: state.rank };
  } catch (error) {
    const apiError = error instanceof ApiError ? error : new ApiError(0, 'network', 'Could not reach the server.');
    if (apiError.code === 'unauthorized') await clearAccount(); // the account no longer exists on the server
    return { status: 'error', error: apiError };
  }
}

/** Registers a nickname and uploads the current progress right away. */
export async function joinLeaderboard(nickname: string, progress: Progress): Promise<{ account: Account; outcome: SyncOutcome }> {
  const client = leaderboardClient();
  if (!client) throw new ApiError(0, 'network', 'The leaderboard server is not configured.');
  const account = await client.register(nickname);
  await saveAccount(account);
  return { account, outcome: await syncScore(progress, { force: true }) };
}
