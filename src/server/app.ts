import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';

import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import { z, ZodError } from 'zod';

import {
  progressInputSchema,
  sourceInputSchema,
  trackInputSchema,
  type PublicUser,
} from '../shared/contracts.js';
import type { AppAuth, SessionUser } from './auth.js';
import type { RuntimeConfig } from './config.js';
import { LibraryRepository, type AppUser } from './database/library-repository.js';

export type MangaDetails = {
  id: string;
  title: string;
  latestChapter: number | null;
  imageUrl: string;
  url: string;
  type: string;
  status: string;
};

export type MangaProvider = {
  search(query: string): Promise<unknown[]>;
  details(id: string): Promise<MangaDetails>;
};

type CreateAppOptions = {
  auth: AppAuth;
  config: RuntimeConfig;
  repository: LibraryRepository;
  provider: MangaProvider;
  refresh: () => Promise<unknown>;
  nextCheck: () => Date | null;
  now?: () => Date;
  log?: (message: string) => void;
};

type RequestState = {
  sessionUser: SessionUser | null;
  appUser: AppUser;
};

const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12),
});
const adminParamsSchema = z.object({ authUserId: z.string().min(1).max(200) });
const adminListSchema = z.object({ status: z.enum(['pending', 'all']).default('pending') });

function errorPayload(code: string, message: string, details?: unknown) {
  return { error: { code, message, ...(details === undefined ? {} : { details }) } };
}

function asyncRoute(
  handler: (request: Request, response: Response, next: NextFunction) => Promise<unknown>,
) {
  return (request: Request, response: Response, next: NextFunction): void => {
    void handler(request, response, next).catch(next);
  };
}

function publicUser(user: SessionUser): PublicUser {
  return {
    id: user.id,
    username: user.username,
    role: user.role === 'admin' ? 'owner' : 'member',
    approvalStatus: 'approved',
    mustChangePassword: user.mustChangePassword,
  };
}

function requestState(response: Response): RequestState {
  return response.locals.state as RequestState;
}

function requireOwner(response: Response): SessionUser | null {
  const user = requestState(response).sessionUser;
  return user?.role === 'admin' ? user : null;
}

function range(start: number, end: number): number[] {
  return start > end ? [] : Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

export function createApp(options: CreateAppOptions): express.Express {
  const { auth, config, repository } = options;
  const now = options.now ?? (() => new Date());
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  app.use((request, response, next) => {
    const started = Date.now();
    response.once('finish', () => {
      options.log?.(`${request.method} ${request.path} ${response.statusCode} ${Date.now() - started}ms`);
    });
    next();
  });

  app.use((request, response, next) => {
    if (
      request.path.startsWith('/api/') &&
      unsafeMethods.has(request.method) &&
      request.get('origin') !== config.publicOrigin
    ) {
      response.status(403).json(errorPayload('ORIGIN_REJECTED', 'Request origin is not allowed'));
      return;
    }
    next();
  });

  app.post(
    '/api/auth/change-password',
    express.json({ limit: '32kb' }),
    asyncRoute(async (request, response) => {
      const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
      if (!session) {
        response.status(401).json(errorPayload('UNAUTHORIZED', 'Authentication required'));
        return;
      }
      const body = changePasswordSchema.parse(request.body);
      await auth.api.changePassword({
        body: { ...body, revokeOtherSessions: true },
        headers: fromNodeHeaders(request.headers),
      });
      repository.setMustChangePassword(session.user.id, false, now());
      response.json({ data: { success: true } });
    }),
  );
  app.use(
    '/api/auth',
    asyncRoute(async (request, response, next) => {
      const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
      const forced = (session?.user as SessionUser | undefined)?.mustChangePassword === true;
      if (!forced) {
        next();
        return;
      }
      const path = request.originalUrl.split('?')[0] ?? '';
      if (path === '/api/auth/get-session' || path === '/api/auth/sign-out') {
        next();
        return;
      }
      response
        .status(403)
        .json(errorPayload('PASSWORD_CHANGE_REQUIRED', 'Change the temporary password to continue'));
    }),
  );
  app.all('/api/auth/*splat', toNodeHandler(auth));
  app.use(express.json({ limit: '32kb' }));

  app.get('/health', (_request, response) => {
    repository.database.prepare('SELECT 1').get();
    response.json({ data: { status: 'ok' } });
  });

  app.use(
    '/api',
    asyncRoute(async (request, response, next) => {
      const session = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
      const sessionUser = (session?.user as SessionUser | undefined) ?? null;
      const isDemoRequest = sessionUser === null;
      const appUser = isDemoRequest ? repository.demoUser() : repository.appUserByAuthId(sessionUser.id);
      if (!appUser) {
        response.status(403).json(errorPayload('ACCOUNT_UNMAPPED', 'Approved account is not mapped'));
        return;
      }
      response.locals.state = { sessionUser, appUser } satisfies RequestState;

      if (sessionUser?.mustChangePassword && request.path !== '/me') {
        response
          .status(403)
          .json(errorPayload('PASSWORD_CHANGE_REQUIRED', 'Change the temporary password to continue'));
        return;
      }

      const isPublic =
        request.method === 'GET' &&
        (request.path === '/me' ||
          request.path === '/manga' ||
          request.path === '/next-check' ||
          /^\/manga\/[^/]+\/chapters$/.test(request.path));
      if (!sessionUser && !isPublic) {
        response.status(401).json(errorPayload('UNAUTHORIZED', 'Authentication required'));
        return;
      }
      next();
    }),
  );

  app.get('/api/me', (_request, response) => {
    const state = requestState(response);
    const user = state.sessionUser ? publicUser(state.sessionUser) : null;
    response.json({
      data: {
        user,
        isDemo: user === null,
        ...(state.sessionUser?.role === 'admin'
          ? { pendingUserCount: repository.pendingUserCount() }
          : {}),
      },
    });
  });

  app.get(
    '/api/search',
    asyncRoute(async (request, response) => {
      const query = z.string().trim().min(2).max(200).parse(request.query.title);
      const subject = request.ip ?? request.socket.remoteAddress ?? 'unknown';
      if (!repository.consumeLimit('provider-search', subject, 30, 60 * 60 * 1000)) {
        response.status(429).json(errorPayload('RATE_LIMITED', 'Search limit exceeded'));
        return;
      }
      response.json({ data: { results: await options.provider.search(query) } });
    }),
  );

  app.get('/api/manga', (_request, response) => {
    response.json({ data: repository.trackedWithChapters(requestState(response).appUser.id) });
  });

  app.get('/api/manga/:mangaId/chapters', (request, response) => {
    const mangaId = z.string().min(1).parse(request.params.mangaId);
    const state = requestState(response);
    if (!repository.trackedById(state.appUser.id, mangaId)) {
      response.status(404).json(errorPayload('NOT_FOUND', 'Tracked manga not found'));
      return;
    }
    response.json({ data: repository.chapters(state.appUser.id, mangaId) });
  });

  app.post(
    '/api/track',
    asyncRoute(async (request, response) => {
      const input = trackInputSchema.parse(request.body);
      const state = requestState(response);
      if (!repository.consumeLimit('provider-track', String(state.appUser.id), 10, 15 * 60 * 1000)) {
        response.status(429).json(errorPayload('RATE_LIMITED', 'Track limit exceeded'));
        return;
      }
      const details = await options.provider.details(input.mangaId);
      const previous = repository.trackedById(state.appUser.id, input.mangaId);
      const seedPreview = !previous && details.latestChapter !== null;
      const lastRead = seedPreview ? Math.max((details.latestChapter ?? 0) - 3, 0) : null;
      repository.track(state.appUser.id, {
        mangaId: input.mangaId,
        title: input.title || details.title,
        coverUrl: input.coverUrl ?? details.imageUrl,
        sourceUrl: input.sourceUrl ?? '',
        latestChapterNumber: details.latestChapter,
        lastReadChapterNumber: lastRead,
      });
      if (seedPreview && details.latestChapter !== null) {
        repository.replaceBacklog(
          state.appUser.id,
          input.mangaId,
          range((lastRead ?? 0) + 1, details.latestChapter),
          now(),
        );
      }
      response.json({ data: { success: true } });
    }),
  );

  app.patch('/api/manga/:mangaId/source', (request, response) => {
    const mangaId = z.string().min(1).parse(request.params.mangaId);
    const { sourceUrl } = sourceInputSchema.parse(request.body);
    if (!repository.updateSource(requestState(response).appUser.id, mangaId, sourceUrl)) {
      response.status(404).json(errorPayload('NOT_FOUND', 'Tracked manga not found'));
      return;
    }
    response.json({ data: { success: true, sourceUrl } });
  });

  app.post('/api/read', (request, response) => {
    const input = progressInputSchema.parse(request.body);
    const chapterNumber = repository.advanceProgress(
      requestState(response).appUser.id,
      input.mangaId,
      input.chapterNumber,
    );
    response.json({ data: { success: true, chapterNumber } });
  });

  app.delete('/api/untrack/:mangaId', (request, response) => {
    const mangaId = z.string().min(1).parse(request.params.mangaId);
    repository.untrack(requestState(response).appUser.id, mangaId);
    response.json({ data: { success: true } });
  });

  app.post(
    '/api/refresh',
    asyncRoute(async (_request, response) => {
      if (!requireOwner(response)) {
        response.status(403).json(errorPayload('FORBIDDEN', 'Owner access required'));
        return;
      }
      response.json({ data: { success: true, result: await options.refresh() } });
    }),
  );

  app.get('/api/next-check', (_request, response) => {
    response.json({ data: { nextCheck: options.nextCheck()?.toISOString() ?? null } });
  });

  app.get('/api/admin/users', (request, response) => {
    if (!requireOwner(response)) {
      response.status(403).json(errorPayload('FORBIDDEN', 'Owner access required'));
      return;
    }
    const { status } = adminListSchema.parse(request.query);
    response.json({ data: { users: repository.listIdentities(status) } });
  });

  app.post('/api/admin/users/:authUserId/approve', (request, response) => {
    const owner = requireOwner(response);
    if (!owner) {
      response.status(403).json(errorPayload('FORBIDDEN', 'Owner access required'));
      return;
    }
    const { authUserId } = adminParamsSchema.parse(request.params);
    const user = repository.approveIdentity(authUserId, owner.id, now());
    response.json({ data: { authUserId, applicationUserId: user.id, approvalStatus: 'approved' } });
  });

  app.post('/api/admin/users/:authUserId/reject', (request, response) => {
    if (!requireOwner(response)) {
      response.status(403).json(errorPayload('FORBIDDEN', 'Owner access required'));
      return;
    }
    const { authUserId } = adminParamsSchema.parse(request.params);
    repository.rejectIdentity(authUserId, now());
    response.json({ data: { authUserId, approvalStatus: 'rejected' } });
  });

  app.post('/api/admin/users/:authUserId/revoke-sessions', (request, response) => {
    if (!requireOwner(response)) {
      response.status(403).json(errorPayload('FORBIDDEN', 'Owner access required'));
      return;
    }
    const { authUserId } = adminParamsSchema.parse(request.params);
    response.json({ data: { revoked: repository.revokeSessions(authUserId) } });
  });

  app.post(
    '/api/admin/users/:authUserId/reset-password',
    asyncRoute(async (request, response) => {
      if (!requireOwner(response)) {
        response.status(403).json(errorPayload('FORBIDDEN', 'Owner access required'));
        return;
      }
      const { authUserId } = adminParamsSchema.parse(request.params);
      const temporaryPassword = randomBytes(18).toString('base64url');
      await auth.api.setUserPassword({
        body: { userId: authUserId, newPassword: temporaryPassword },
        headers: fromNodeHeaders(request.headers),
      });
      repository.revokeSessions(authUserId);
      repository.setMustChangePassword(authUserId, true, now());
      response.json({ data: { temporaryPassword } });
    }),
  );

  app.use('/api', (_request, response) => {
    response.status(404).json(errorPayload('NOT_FOUND', 'API route not found'));
  });

  if (config.environment !== 'test' && existsSync(config.clientDirectory)) {
    app.use(express.static(config.clientDirectory, { index: false }));
    app.get('/', (_request, response) => response.sendFile('index.html', { root: config.clientDirectory }));
    app.get('/admin', (_request, response) => response.sendFile('index.html', { root: config.clientDirectory }));
    app.get('*splat', (_request, response) => response.sendFile('index.html', { root: config.clientDirectory }));
  }

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    void _next;
    if (error instanceof ZodError) {
      response
        .status(400)
        .json(errorPayload('INVALID_REQUEST', 'Request validation failed', error.flatten()));
      return;
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    if (message === 'IDENTITY_NOT_FOUND') {
      response.status(404).json(errorPayload('NOT_FOUND', 'User not found'));
      return;
    }
    if (message === 'OWNER_IMMUTABLE') {
      response.status(409).json(errorPayload('CONFLICT', 'The owner cannot be changed'));
      return;
    }
    options.log?.(`request failed: ${message}`);
    response.status(500).json(errorPayload('INTERNAL_ERROR', 'Request failed'));
  });

  return app;
}
