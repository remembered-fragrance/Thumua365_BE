/**
 * Ranh giới giữa các gói — CI đỏ nếu vi phạm.
 *
 * `@mambo/core` chạy ở cả trình duyệt (frontend) lẫn Node (NestJS), nên nó
 * không được import thứ gì ngoài chính nó: không thư viện ngoài, không Node
 * built-in, không gói khác trong repo. Giữ được luật này thì một hàm tính tiền
 * cho ra đúng một con số ở cả hai phía.
 */
module.exports = {
  forbidden: [
    {
      name: 'core-thuan',
      comment: 'packages/core chỉ import chính nó',
      severity: 'error',
      from: { path: '^packages/core/src' },
      to: { pathNot: '^packages/core/src' },
    },
    {
      name: 'contracts-chi-zod-va-core',
      comment: 'packages/contracts chỉ dùng zod và @mambo/core',
      severity: 'error',
      from: { path: '^packages/contracts/src' },
      to: {
        pathNot: ['^packages/contracts/src', '^packages/core/', 'node_modules/zod'],
      },
    },
    {
      name: 'khong-vong',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(dist|coverage|node_modules)/' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
  },
};
