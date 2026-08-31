import type Database from 'better-sqlite3';
import { APIError, betterAuth } from 'better-auth';
import { admin, username } from 'better-auth/plugins';

import type { RuntimeConfig } from './config.js';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export type InternalRole = 'admin' | 'user';

export type SessionUser = {
  id: string;
  username: string;
  email: string;
  role: InternalRole;
  approvalStatus: ApprovalStatus;
  mustChangePassword: boolean;
};

type BuildAuthOptions = {
  database: Database.Database;
  config: RuntimeConfig;
};

export function buildAuth({ database, config }: BuildAuthOptions) {
  const isProduction = config.environment === 'production';
  return betterAuth({
    database,
    secret: config.sessionSecret,
    baseURL: config.publicOrigin,
    trustedOrigins: [config.publicOrigin],
    emailAndPassword: {
      enabled: true,
      autoSignIn: false,
      minPasswordLength: 12,
      requireEmailVerification: false,
    },
    session: {
      expiresIn: config.sessionMaxAgeSeconds,
    },
    user: {
      additionalFields: {
        approvalStatus: {
          type: 'string',
          required: true,
          defaultValue: 'pending',
          input: false,
        },
        mustChangePassword: {
          type: 'boolean',
          required: true,
          defaultValue: false,
          input: false,
        },
        approvedAt: { type: 'string', required: false, input: false },
        approvedBy: { type: 'string', required: false, input: false },
      },
    },
    databaseHooks: {
      session: {
        create: {
          // Better Auth requires an async hook signature even though SQLite lookup is synchronous.
          // eslint-disable-next-line @typescript-eslint/require-await
          before: async (session) => {
            const row = database
              .prepare('SELECT "approvalStatus" FROM "user" WHERE "id" = ?')
              .get(session.userId) as { approvalStatus?: string } | undefined;
            if (row?.approvalStatus === 'pending') {
              throw new APIError('FORBIDDEN', {
                code: 'ACCOUNT_PENDING',
                message: 'This account is waiting for owner approval.',
              });
            }
            if (row?.approvalStatus !== 'approved') {
              throw new APIError('FORBIDDEN', {
                code: 'ACCOUNT_REJECTED',
                message: 'This account has been rejected.',
              });
            }
            return { data: session };
          },
        },
      },
    },
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/username': { window: 15 * 60, max: 5 },
        '/sign-in/email': { window: 15 * 60, max: 5 },
        '/sign-up/email': { window: 60 * 60, max: 3 },
      },
    },
    advanced: {
      useSecureCookies: false,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'strict',
        path: '/',
        secure: isProduction,
      },
      cookies: {
        session_token: {
          name: isProduction ? '__Host-mt_session' : 'mt_session',
        },
      },
    },
    plugins: [
      username({ minUsernameLength: 3, maxUsernameLength: 30 }),
      admin({ defaultRole: 'user', adminRoles: ['admin'] }),
    ],
  });
}

export type AppAuth = ReturnType<typeof buildAuth>;
