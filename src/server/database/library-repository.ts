import type Database from 'better-sqlite3';

export type AppUser = {
  id: number;
  username: string;
  authUserId: string | null;
};

export type TrackedManga = {
  id: number;
  userId: number;
  mangaId: string;
  mangaTitle: string;
  coverUrl: string;
  sourceUrl: string;
  provider: string | null;
  providerSeriesId: string | null;
  latestChapterNumber: number | null;
  lastReadChapterNumber: number | null;
  migrationStatus: string | null;
  addedAt: string;
};

export type ChapterPreview = {
  id: string;
  attributes: {
    chapter: string;
    title: null;
    publishAt: null;
    createdAt: string;
  };
  isRead: false;
};

type TrackedRow = {
  id: number;
  user_id: number;
  manga_id: string;
  manga_title: string;
  cover_url: string | null;
  source_url: string | null;
  provider: string | null;
  provider_series_id: string | null;
  latest_chapter_number: number | null;
  last_read_chapter_number: number | null;
  migration_status: string | null;
  added_at: string;
};

function presentTracked(row: TrackedRow): TrackedManga {
  return {
    id: row.id,
    userId: row.user_id,
    mangaId: row.manga_id,
    mangaTitle: row.manga_title,
    coverUrl: row.cover_url ?? '',
    sourceUrl: row.source_url ?? '',
    provider: row.provider,
    providerSeriesId: row.provider_series_id,
    latestChapterNumber: row.latest_chapter_number,
    lastReadChapterNumber: row.last_read_chapter_number,
    migrationStatus: row.migration_status,
    addedAt: row.added_at,
  };
}

function chapterPreview(mangaId: string, chapterNumber: number, detectedAt: string): ChapterPreview {
  return {
    id: `${mangaId}:${chapterNumber}`,
    attributes: {
      chapter: String(chapterNumber),
      title: null,
      publishAt: null,
      createdAt: detectedAt,
    },
    isRead: false,
  };
}

export class LibraryRepository {
  constructor(readonly database: Database.Database) {}

  appUserByAuthId(authUserId: string): AppUser | null {
    const row = this.database
      .prepare('SELECT id, username, auth_user_id AS authUserId FROM users WHERE auth_user_id = ?')
      .get(authUserId) as AppUser | undefined;
    return row ?? null;
  }

  demoUser(): AppUser {
    const row = this.database
      .prepare('SELECT id, username, auth_user_id AS authUserId FROM users WHERE id = 2')
      .get() as AppUser | undefined;
    if (!row) throw new Error('Demo application user id=2 is missing');
    return row;
  }

  approveIdentity(authUserId: string, approvedBy: string, approvedAt: Date): AppUser {
    const transaction = this.database.transaction(() => {
      const timestamp = approvedAt.toISOString();
      const identity = this.database
        .prepare('SELECT "id", "username", "role" FROM "user" WHERE "id" = ?')
        .get(authUserId) as { id: string; username: string | null; role: string } | undefined;
      if (!identity) throw new Error('IDENTITY_NOT_FOUND');
      if (identity.role === 'admin') throw new Error('OWNER_IMMUTABLE');
      if (!identity.username) throw new Error('IDENTITY_USERNAME_MISSING');

      let appUser = this.appUserByAuthId(authUserId);
      if (!appUser) {
        const result = this.database
          .prepare('INSERT INTO users(username, auth_user_id) VALUES (?, ?)')
          .run(identity.username, authUserId);
        appUser = { id: Number(result.lastInsertRowid), username: identity.username, authUserId };
      }
      this.database
        .prepare(
          `UPDATE "user"
           SET "approvalStatus" = 'approved', "approvedAt" = ?, "approvedBy" = ?,
               "banned" = 0, "banReason" = NULL, "banExpires" = NULL, "updatedAt" = ?
           WHERE "id" = ?`,
        )
        .run(timestamp, approvedBy, timestamp, authUserId);
      return appUser;
    });
    return transaction();
  }

  rejectIdentity(authUserId: string, now: Date): void {
    const transaction = this.database.transaction(() => {
      const target = this.database
        .prepare('SELECT "role" FROM "user" WHERE "id" = ?')
        .get(authUserId) as { role: string } | undefined;
      if (!target) throw new Error('IDENTITY_NOT_FOUND');
      if (target.role === 'admin') throw new Error('OWNER_IMMUTABLE');
      this.database
        .prepare(
          `UPDATE "user" SET "approvalStatus" = 'rejected', "banned" = 0,
           "banReason" = NULL, "updatedAt" = ? WHERE "id" = ?`,
        )
        .run(now.toISOString(), authUserId);
      this.database.prepare('DELETE FROM session WHERE "userId" = ?').run(authUserId);
    });
    transaction();
  }

  revokeSessions(authUserId: string): number {
    return this.database.prepare('DELETE FROM session WHERE "userId" = ?').run(authUserId).changes;
  }

  setMustChangePassword(authUserId: string, required: boolean, now: Date): void {
    const result = this.database
      .prepare('UPDATE "user" SET "mustChangePassword" = ?, "updatedAt" = ? WHERE "id" = ?')
      .run(required ? 1 : 0, now.toISOString(), authUserId);
    if (result.changes !== 1) throw new Error('IDENTITY_NOT_FOUND');
  }

  pendingUserCount(): number {
    const row = this.database
      .prepare(`SELECT COUNT(*) AS count FROM "user" WHERE "approvalStatus" = 'pending'`)
      .get() as { count: number };
    return row.count;
  }

  listIdentities(status: 'pending' | 'all'): Record<string, unknown>[] {
    return this.database
      .prepare(
        `SELECT u."id", u."username", u."email", u."createdAt", u."approvalStatus", u."role",
                u."mustChangePassword", u."approvedAt", u."approvedBy", a.id AS applicationUserId,
                (SELECT COUNT(*) FROM tracked_manga t WHERE t.user_id = a.id) AS trackedCount
         FROM "user" u
         LEFT JOIN users a ON a.auth_user_id = u."id"
         ${status === 'pending' ? `WHERE u."approvalStatus" = 'pending'` : ''}
         ORDER BY CASE u."approvalStatus" WHEN 'pending' THEN 0 ELSE 1 END, u."createdAt" DESC`,
      )
      .all() as Record<string, unknown>[];
  }

  tracked(userId: number): TrackedManga[] {
    return (this.database
      .prepare('SELECT * FROM tracked_manga WHERE user_id = ? ORDER BY added_at DESC')
      .all(userId) as TrackedRow[]).map(presentTracked);
  }

  trackedForSync(): TrackedManga[] {
    return (this.database
      .prepare(`
        SELECT * FROM tracked_manga
        WHERE provider = 'mangaupdates' AND provider_series_id IS NOT NULL
          AND migration_status = 'resolved'
        ORDER BY added_at DESC
      `)
      .all() as TrackedRow[]).map(presentTracked);
  }

  trackedById(userId: number, mangaId: string): TrackedManga | null {
    const row = this.database
      .prepare('SELECT * FROM tracked_manga WHERE user_id = ? AND manga_id = ?')
      .get(userId, mangaId) as TrackedRow | undefined;
    return row ? presentTracked(row) : null;
  }

  track(
    userId: number,
    input: {
      mangaId: string;
      title: string;
      coverUrl: string;
      sourceUrl: string;
      latestChapterNumber: number | null;
      lastReadChapterNumber: number | null;
    },
  ): void {
    this.database
      .prepare(`
        INSERT INTO tracked_manga (
          user_id, manga_id, manga_title, cover_url, source_url, provider, provider_series_id,
          latest_chapter_number, last_read_chapter_number, migration_status
        ) VALUES (?, ?, ?, ?, ?, 'mangaupdates', ?, ?, ?, 'resolved')
        ON CONFLICT(user_id, manga_id) DO UPDATE SET
          manga_title = excluded.manga_title,
          cover_url = CASE WHEN excluded.cover_url = '' THEN tracked_manga.cover_url ELSE excluded.cover_url END,
          source_url = CASE WHEN excluded.source_url = '' THEN tracked_manga.source_url ELSE excluded.source_url END,
          provider = excluded.provider,
          provider_series_id = excluded.provider_series_id,
          latest_chapter_number = COALESCE(excluded.latest_chapter_number, tracked_manga.latest_chapter_number),
          last_read_chapter_number = COALESCE(tracked_manga.last_read_chapter_number, excluded.last_read_chapter_number),
          migration_status = 'resolved'
      `)
      .run(
        userId,
        input.mangaId,
        input.title,
        input.coverUrl,
        input.sourceUrl,
        input.mangaId,
        input.latestChapterNumber,
        input.lastReadChapterNumber,
      );
  }

  untrack(userId: number, mangaId: string): void {
    const transaction = this.database.transaction(() => {
      this.database.prepare('DELETE FROM read_chapters WHERE user_id = ? AND manga_id = ?').run(userId, mangaId);
      this.database.prepare('DELETE FROM unread_backlog WHERE user_id = ? AND manga_id = ?').run(userId, mangaId);
      this.database.prepare('DELETE FROM tracked_manga WHERE user_id = ? AND manga_id = ?').run(userId, mangaId);
    });
    transaction();
  }

  replaceBacklog(userId: number, mangaId: string, chapters: readonly number[], now = new Date()): void {
    const unique = [...new Set(chapters.filter((chapter) => Number.isInteger(chapter) && chapter >= 0))];
    const transaction = this.database.transaction(() => {
      this.database.prepare('DELETE FROM unread_backlog WHERE user_id = ? AND manga_id = ?').run(userId, mangaId);
      const insert = this.database.prepare(
        'INSERT INTO unread_backlog(user_id, manga_id, chapter_number, detected_at) VALUES (?, ?, ?, ?)',
      );
      for (const chapter of unique) insert.run(userId, mangaId, chapter, now.toISOString());
    });
    transaction();
  }

  addBacklog(userId: number, mangaId: string, chapters: readonly number[], now = new Date()): void {
    const insert = this.database.prepare(
      `INSERT OR IGNORE INTO unread_backlog(user_id, manga_id, chapter_number, detected_at)
       VALUES (?, ?, ?, ?)`,
    );
    const transaction = this.database.transaction(() => {
      for (const chapter of new Set(chapters)) {
        if (Number.isInteger(chapter) && chapter >= 0) insert.run(userId, mangaId, chapter, now.toISOString());
      }
    });
    transaction();
  }

  highestBacklog(userId: number, mangaId: string): number | null {
    const row = this.database
      .prepare('SELECT MAX(chapter_number) AS chapter FROM unread_backlog WHERE user_id = ? AND manga_id = ?')
      .get(userId, mangaId) as { chapter: number | null };
    return row.chapter;
  }

  updateLatest(userId: number, mangaId: string, latestChapter: number): void {
    this.database
      .prepare('UPDATE tracked_manga SET latest_chapter_number = ? WHERE user_id = ? AND manga_id = ?')
      .run(latestChapter, userId, mangaId);
  }

  resetLibrary(userId: number): void {
    const transaction = this.database.transaction(() => {
      this.database.prepare('DELETE FROM read_chapters WHERE user_id = ?').run(userId);
      this.database.prepare('DELETE FROM unread_backlog WHERE user_id = ?').run(userId);
      this.database.prepare('DELETE FROM tracked_manga WHERE user_id = ?').run(userId);
    });
    transaction();
  }

  chapters(userId: number, mangaId: string, limit = 50): ChapterPreview[] {
    if (!this.trackedById(userId, mangaId)) return [];
    const rows = this.database
      .prepare(
        `SELECT chapter_number AS chapterNumber, detected_at AS detectedAt
         FROM unread_backlog WHERE user_id = ? AND manga_id = ?
         ORDER BY chapter_number DESC LIMIT ?`,
      )
      .all(userId, mangaId, limit) as { chapterNumber: number; detectedAt: string }[];
    return rows.map((row) => chapterPreview(mangaId, row.chapterNumber, row.detectedAt));
  }

  trackedWithChapters(userId: number): Record<string, unknown>[] {
    return this.tracked(userId).map((manga) => ({
      id: manga.id,
      user_id: manga.userId,
      manga_id: manga.mangaId,
      manga_title: manga.mangaTitle,
      cover_url: manga.coverUrl,
      source_url: manga.sourceUrl,
      provider: manga.provider,
      provider_series_id: manga.providerSeriesId,
      latest_chapter_number: manga.latestChapterNumber,
      last_read_chapter_number: manga.lastReadChapterNumber,
      migration_status: manga.migrationStatus,
      added_at: manga.addedAt,
      lastReadChapter: manga.lastReadChapterNumber,
      latestChapter: manga.latestChapterNumber,
      unreadCount: this.backlogCount(userId, manga.mangaId),
      chapters: this.chapters(userId, manga.mangaId, 10),
    }));
  }

  backlogCount(userId: number, mangaId: string): number {
    const row = this.database
      .prepare('SELECT COUNT(*) AS count FROM unread_backlog WHERE user_id = ? AND manga_id = ?')
      .get(userId, mangaId) as { count: number };
    return row.count;
  }

  advanceProgress(userId: number, mangaId: string, chapterNumber: number): number {
    const manga = this.trackedById(userId, mangaId);
    if (!manga) throw new Error('MANGA_NOT_FOUND');
    const next = Math.max(manga.lastReadChapterNumber ?? 0, chapterNumber);
    const transaction = this.database.transaction(() => {
      this.database
        .prepare('UPDATE tracked_manga SET last_read_chapter_number = ? WHERE user_id = ? AND manga_id = ?')
        .run(next, userId, mangaId);
      this.database
        .prepare('DELETE FROM unread_backlog WHERE user_id = ? AND manga_id = ? AND chapter_number <= ?')
        .run(userId, mangaId, next);
    });
    transaction();
    return next;
  }

  updateSource(userId: number, mangaId: string, sourceUrl: string): boolean {
    return this.database
      .prepare('UPDATE tracked_manga SET source_url = ? WHERE user_id = ? AND manga_id = ?')
      .run(sourceUrl, userId, mangaId).changes === 1;
  }

  consumeLimit(bucket: string, subject: string, max: number, windowMs: number, now = Date.now()): boolean {
    const transaction = this.database.transaction(() => {
      const row = this.database
        .prepare(
          `SELECT window_started_at AS windowStartedAt, request_count AS requestCount
           FROM operation_rate_limits WHERE bucket = ? AND subject = ?`,
        )
        .get(bucket, subject) as { windowStartedAt: number; requestCount: number } | undefined;
      if (!row || row.windowStartedAt + windowMs <= now) {
        this.database
          .prepare(`
            INSERT INTO operation_rate_limits(bucket, subject, window_started_at, request_count)
            VALUES (?, ?, ?, 1)
            ON CONFLICT(bucket, subject) DO UPDATE SET
              window_started_at = excluded.window_started_at, request_count = 1
          `)
          .run(bucket, subject, now);
        return true;
      }
      if (row.requestCount >= max) return false;
      this.database
        .prepare(
          'UPDATE operation_rate_limits SET request_count = request_count + 1 WHERE bucket = ? AND subject = ?',
        )
        .run(bucket, subject);
      return true;
    });
    return transaction();
  }
}
