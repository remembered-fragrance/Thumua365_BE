import 'reflect-metadata';
import type { MeMembership } from '@mambo/contracts';
import type { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWTPayload } from 'jose';
import { AppModule } from '../src/app.module';
import { type MembershipContext, type MembershipLookup, NoMembershipsYet } from '../src/auth/membership';
import type { SupabaseAdmin } from '../src/auth/supabase-admin';
import type { SupabaseAccount, SupabaseUsers } from '../src/auth/supabase-users';
import { configureApp } from '../src/bootstrap';
import { type Env, loadEnv } from '../src/config/env';
import { Database } from '../src/db/database';
import { buildLogger } from '../src/logger';

export const SUPABASE_URL = 'https://testref.supabase.co';
export const USER_ID = '6f1c1d2e-3b4a-4c5d-8e9f-0a1b2c3d4e5f';
export const ORG_ID = '0b9e4c1a-2d3f-4a5b-9c6d-7e8f9a0b1c2d';
export const ALLOWED_ORIGIN = 'https://app.thumua365.vn';

type KeyPair = Awaited<ReturnType<typeof generateKeyPair>>;

/** Cặp khoá ES256 giống cách Supabase ký. Tạo một lần cho cả file test. */
export const makeSigner = async () => {
  const pair: KeyPair = await generateKeyPair('ES256', { extractable: true });
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-key', alg: 'ES256', use: 'sig' };
  const jwks = createLocalJWKSet({ keys: [jwk] });

  const sign = (claims: JWTPayload = {}, opts: { issuer?: string; expiresIn?: string; key?: KeyPair } = {}) =>
    new SignJWT({ role: 'authenticated', ...claims })
      .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
      .setSubject(typeof claims.sub === 'string' ? claims.sub : USER_ID)
      .setIssuer(opts.issuer ?? `${SUPABASE_URL}/auth/v1`)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime(opts.expiresIn ?? '1h')
      .sign((opts.key ?? pair).privateKey);

  return { jwks, sign, otherKey: () => generateKeyPair('ES256') };
};

/** Supabase Auth giả: trả tài khoản cố định và ghi lại token được dùng. */
export class FakeSupabaseUsers implements SupabaseUsers {
  readonly tokens: string[] = [];
  account: SupabaseAccount = {
    id: USER_ID,
    email: '84912345678@id.thumua365.vn',
    phone: '84912345678',
    phone_confirmed_at: '2026-09-21T03:00:00Z',
    user_metadata: { name: 'Cô Mai' },
  };
  failWith: Error | null = null;

  async fetch(token: string): Promise<SupabaseAccount> {
    this.tokens.push(token);
    if (this.failWith) throw this.failWith;
    return this.account;
  }
}

/** Membership trong bộ nhớ, cho test guard tổ chức. */
export class FakeMemberships implements MembershipLookup {
  readonly byOrg = new Map<string, MembershipContext>();

  async find(userId: string, organizationId: string): Promise<MembershipContext | null> {
    return userId === USER_ID ? (this.byOrg.get(organizationId) ?? null) : null;
  }

  async listForUser(): Promise<MeMembership[]> {
    return [];
  }

  async pendingLinks(): Promise<number> {
    return 0;
  }
}

/** Auth Admin giả: id → email đăng nhập. */
export class FakeSupabaseAdmin implements SupabaseAdmin {
  readonly emails = new Map<string, string>();
  readonly asked: string[] = [];

  async loginEmail(userId: string): Promise<string | null> {
    this.asked.push(userId);
    return this.emails.get(userId) ?? null;
  }
}

/**
 * Postgres cho test không cần database: kết nối lười, không bao giờ được chạm tới.
 * Test cần database thật nằm ở tests/db/ (`npm run test:db`).
 */
export const UNUSED_DATABASE_URL = 'postgresql://unused:unused@127.0.0.1:1/unused';

export const testEnv = (overrides: Record<string, string> = {}): Env =>
  loadEnv({
    APP_ENV: 'staging',
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    SUPABASE_SECRET_KEY: 'sb_secret_test',
    DATABASE_URL: UNUSED_DATABASE_URL,
    CORS_ORIGINS: ALLOWED_ORIGIN,
    RENDER_GIT_COMMIT: 'abcdef1234567',
    ...overrides,
  });

export interface TestAppOptions {
  readonly env?: Env;
  readonly jwks: Awaited<ReturnType<typeof makeSigner>>['jwks'];
  readonly supabaseUsers?: SupabaseUsers;
  readonly supabaseAdmin?: SupabaseAdmin;
  readonly memberships?: MembershipLookup;
  readonly db?: Database;
  /** Controller chỉ có trong test — để thử guard và interceptor với route giả. */
  readonly extraControllers?: Type[];
}

/** Dựng đúng app như main.ts, chỉ thay phụ thuộc chạm ra ngoài. */
export const buildTestApp = async (options: TestAppOptions): Promise<INestApplication> => {
  const env = options.env ?? testEnv();
  const logger = buildLogger(env, true);
  const moduleRef = await Test.createTestingModule({
    imports: [
      AppModule.forRoot(env, {
        jwks: options.jwks,
        supabaseUsers: options.supabaseUsers ?? new FakeSupabaseUsers(),
        supabaseAdmin: options.supabaseAdmin ?? new FakeSupabaseAdmin(),
        memberships: options.memberships ?? new NoMembershipsYet(),
        db: options.db ?? new Database(env.DATABASE_URL),
        logger,
      }),
    ],
    controllers: options.extraControllers ?? [],
  }).compile();

  const app = moduleRef.createNestApplication({ bodyParser: false, logger: false });
  configureApp(app, env, logger);
  await app.init();
  return app;
};
