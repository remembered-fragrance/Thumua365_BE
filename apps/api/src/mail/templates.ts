/**
 * Nội dung hai loại thư. Câu ngắn, một nút, có link dạng chữ cho máy không hiện nút. Không chèn gì
 * người dùng gõ vào thư (tên, email) — thư chỉ có link do API dựng.
 */

import type { Mail } from './mailer';

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const layout = (title: string, lines: readonly string[], button: string, link: string, footer: string): string => {
  const href = escapeHtml(link);
  const paragraphs = lines.map((l) => `<p style="margin:0 0 12px">${escapeHtml(l)}</p>`).join('');
  return `<!doctype html><html lang="vi"><body style="margin:0;padding:24px;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif;color:#1c1917">
<div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:24px">
<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(title)}</h1>
${paragraphs}
<p style="margin:20px 0"><a href="${href}" style="display:inline-block;background:#15803d;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold">${escapeHtml(button)}</a></p>
<p style="margin:0 0 12px;font-size:13px;color:#57534e">Nút không bấm được thì mở link này:<br><a href="${href}" style="color:#15803d;word-break:break-all">${href}</a></p>
<p style="margin:16px 0 0;font-size:13px;color:#57534e">${escapeHtml(footer)}</p>
</div></body></html>`;
};

export const verifyEmailMail = (to: string, link: string): Mail => {
  const lines = ['Bạn (hoặc ai đó) vừa đặt email này làm email khôi phục cho tài khoản THUMUA365.', 'Bấm nút bên dưới để xác nhận. Link dùng được một lần, trong 24 giờ.'];
  const footer = 'Không phải bạn? Bỏ qua thư này — email sẽ không được dùng để lấy lại mật khẩu.';
  return {
    to,
    subject: 'Xác nhận email khôi phục — THUMUA365',
    text: `${lines.join('\n')}\n\n${link}\n\n${footer}`,
    html: layout('Xác nhận email khôi phục', lines, 'Xác nhận email', link, footer),
  };
};

export const resetPasswordMail = (to: string, link: string): Mail => {
  const lines = ['Có yêu cầu đặt lại mật khẩu cho tài khoản THUMUA365 gắn với email này.', 'Bấm nút bên dưới để đặt mật khẩu mới. Link dùng được một lần và hết hạn sau ít phút.'];
  const footer = 'Không phải bạn yêu cầu? Bỏ qua thư này — mật khẩu cũ vẫn dùng bình thường.';
  return {
    to,
    subject: 'Đặt lại mật khẩu — THUMUA365',
    text: `${lines.join('\n')}\n\n${link}\n\n${footer}`,
    html: layout('Đặt lại mật khẩu', lines, 'Đặt mật khẩu mới', link, footer),
  };
};
