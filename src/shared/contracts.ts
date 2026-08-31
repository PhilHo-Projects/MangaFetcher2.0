import { z } from 'zod';

export const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export const publicUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  role: z.enum(['owner', 'member']),
  approvalStatus: z.literal('approved'),
  mustChangePassword: z.boolean(),
});

export const meResponseSchema = z.object({
  data: z.object({
    user: publicUserSchema.nullable(),
    isDemo: z.boolean(),
    pendingUserCount: z.number().int().nonnegative().optional(),
  }),
});

export const trackInputSchema = z.object({
  mangaId: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(500),
  coverUrl: z.url().or(z.literal('')).optional(),
  sourceUrl: z.url().or(z.literal('')).optional(),
});

export const progressInputSchema = z.object({
  mangaId: z.string().trim().min(1).max(200),
  chapterNumber: z.coerce.number().int().nonnegative(),
});

export const sourceInputSchema = z.object({
  sourceUrl: z.url().or(z.literal('')),
});

export type PublicUser = z.infer<typeof publicUserSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
export type TrackInput = z.infer<typeof trackInputSchema>;
