/**
 * Luật mật khẩu — MỘT nơi cho mọi chỗ đặt mật khẩu: đăng ký, đổi mật khẩu, đặt lại qua email, chủ
 * tạo tài khoản nhân viên, quản trị viên đặt lại. Trước 0.16.0 đăng ký / đổi là 6, tạo nhân viên và
 * quản trị là 8 — người dùng gặp hai luật khác nhau cho cùng một thứ.
 *
 * Tối đa 72 vì Supabase Auth băm bằng bcrypt: phần sau byte thứ 72 bị bỏ qua. Mật khẩu toàn số vẫn
 * được (tệp người dùng gõ trên bàn phím số). Supabase Auth cũng phải đặt "Minimum password length"
 * = PASSWORD_MIN_LENGTH, vì đăng ký và đổi mật khẩu đi thẳng từ app tới Supabase.
 * Mật khẩu cũ ngắn hơn vẫn đăng nhập được — luật chỉ áp khi đặt mật khẩu mới.
 */

import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;

export const Password = z.string().min(PASSWORD_MIN_LENGTH).max(PASSWORD_MAX_LENGTH);
