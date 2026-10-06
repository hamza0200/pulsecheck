import { z } from 'zod';

// [Node concept: .env handling] process.loadEnvFile() (Node 21.7+) reads ./.env without a
// dependency. Variables already present in process.env take precedence, which is how
// tests and CI override DATABASE_URL.
try {
  process.loadEnvFile();
} catch {
  // No .env file — rely on the real environment (CI, production).
}

const booleanString = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    APP_URL: z.url().default('http://localhost:5173'),
    DATABASE_URL: z.string().startsWith('postgresql://'),
    TEST_DATABASE_URL: z.string().startsWith('postgresql://').optional(),
    JWT_ACCESS_SECRET: z.string().min(8),
    JWT_REFRESH_SECRET: z.string().min(8),
    SCHEDULER_ENABLED: booleanString.default(true),
    MAX_MONITORS_PER_USER: z.coerce.number().int().min(1).default(20),
    ALLOW_PRIVATE_TARGETS: booleanString.default(false),
    SMTP_HOST: z.string().min(1).default('localhost'),
    SMTP_PORT: z.coerce.number().int().default(1025),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    MAIL_FROM: z.string().min(3).default('PulseCheck <no-reply@pulsecheck.local>'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
      if (env[key].length < 32 || env[key].startsWith('change-me')) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'must be a random string of at least 32 characters in production',
        });
      }
    }
    if (env.ALLOW_PRIVATE_TARGETS) {
      ctx.addIssue({
        code: 'custom',
        path: ['ALLOW_PRIVATE_TARGETS'],
        message: 'must be false in production',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    // The logger depends on env, so print directly and fail fast.
    console.error('❌ Invalid environment variables:\n' + z.prettifyError(result.error));
    console.error('\nCopy backend/.env.example to backend/.env and fix the values above.');
    process.exit(1);
  }
  return result.data;
}

export const env = loadEnv();
