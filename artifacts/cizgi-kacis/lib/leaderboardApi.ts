/**
 * HTTP client for the world leaderboard. Pure (no React Native imports) so it can be tested against the real
 * server under plain Node. `fetchImpl` and `timeoutMs` are injectable.
 */

export type LeaderboardEntry = { rank: number; nickname: string; score: number; levelsCleared: number; stars: number; isMe: boolean };
export type Board = { entries: LeaderboardEntry[]; total: number; me: LeaderboardEntry | null; around: LeaderboardEntry[] };
export type Account = { id: string; secret: string; nickname: string };
export type ScoreResult = { accepted: boolean; score: number; levelsCleared: number; stars: number; rank: number; total: number };
export type Snapshot = { score: number; levelsCleared: number; stars: number; bestLevel: number };

export type ApiErrorCode = 'network' | 'timeout' | 'invalid_nickname' | 'invalid_score' | 'unauthorized' | 'rate_limited' | 'unavailable' | 'bad_response' | 'server_error';

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly reason?: string;
  readonly retryAfterSeconds?: number;
  constructor(status: number, code: ApiErrorCode, message: string, extra: { reason?: string; retryAfterSeconds?: number } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.reason = extra.reason;
    this.retryAfterSeconds = extra.retryAfterSeconds;
  }
}

type Options = { baseUrl: string; fetchImpl?: typeof fetch; timeoutMs?: number };

const KNOWN: ApiErrorCode[] = ['invalid_nickname', 'invalid_score', 'unauthorized', 'rate_limited', 'unavailable', 'server_error'];

export function createLeaderboardClient({ baseUrl, fetchImpl = fetch, timeoutMs = 8000 }: Options) {
  const root = baseUrl.replace(/\/+$/, '');

  async function request<T>(method: string, path: string, options: { body?: unknown; auth?: Account } = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(root + path, {
        method,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(options.auth ? { 'X-Player-Id': options.auth.id, Authorization: `Bearer ${options.auth.secret}` } : {}),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch (error) {
      const aborted = (error as { name?: string })?.name === 'AbortError';
      throw new ApiError(0, aborted ? 'timeout' : 'network', aborted ? 'The server did not answer in time.' : 'Could not reach the server.');
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 204) return undefined as T;
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (response.ok) {
      if (payload === null || typeof payload !== 'object') throw new ApiError(response.status, 'bad_response', 'Unexpected answer from the server.');
      return payload as T;
    }
    const body = (payload ?? {}) as { error?: string; message?: string; reason?: string; retryAfterSeconds?: number };
    const code = (KNOWN.includes(body.error as ApiErrorCode) ? body.error : response.status >= 500 ? 'server_error' : 'bad_response') as ApiErrorCode;
    throw new ApiError(response.status, code, body.message ?? `Request failed (${response.status}).`, { reason: body.reason, retryAfterSeconds: body.retryAfterSeconds });
  }

  return {
    register: (nickname: string) => request<Account>('POST', '/players', { body: { nickname } }),
    rename: (auth: Account, nickname: string) => request<{ nickname: string }>('PATCH', '/players/me', { body: { nickname }, auth }),
    submitScore: (auth: Account, snapshot: Snapshot) => request<ScoreResult>('PUT', '/players/me/score', { body: snapshot, auth }),
    board: (limit = 50, auth?: Account) => request<Board>('GET', `/leaderboard?limit=${encodeURIComponent(String(limit))}`, { auth }),
    deleteAccount: (auth: Account) => request<void>('DELETE', '/players/me', { auth }),
  };
}

export type LeaderboardClient = ReturnType<typeof createLeaderboardClient>;
