import { type JWTVerifyGetKey, jwtVerify } from 'jose';

/** Người gọi, đọc từ JWT đã kiểm chữ ký. */
export interface AuthUser {
  readonly id: string;
  /** Giữ lại để gọi Supabase Auth thay mặt chính người đó (`/auth/v1/user`). */
  readonly token: string;
}

/** Nguồn khoá công khai: JWKS từ xa ở môi trường thật, khoá tạo tại chỗ trong test. */
export const JWKS = Symbol('JWKS');
export type Jwks = JWTVerifyGetKey;

/**
 * Kiểm token do Supabase Auth phát.
 *
 * Supabase ký bằng ES256 (đã kiểm ở cả hai project, 21/09/2026) nên API chỉ cần
 * khoá CÔNG KHAI — không giữ JWT secret nào. Chặn thêm hai thứ chữ ký đúng vẫn
 * không đủ: `role` phải là `authenticated` (khoá anon cũng là JWT hợp lệ) và
 * phải có `sub`.
 */
export const verifySupabaseToken = async (token: string, jwks: Jwks, supabaseUrl: string): Promise<AuthUser> => {
  const { payload } = await jwtVerify(token, jwks, {
    issuer: `${supabaseUrl}/auth/v1`,
    audience: 'authenticated',
    algorithms: ['ES256'],
  });
  if (payload.role !== 'authenticated' || typeof payload.sub !== 'string' || payload.sub === '') {
    throw new Error('Token không phải của người dùng đã đăng nhập');
  }
  return { id: payload.sub, token };
};
