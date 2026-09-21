import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import pkg from '../package.json' with { type: 'json' };
import { buildOpenApi } from '../src/openapi.js';
import { routes } from '../src/routes.js';

const doc = buildOpenApi(pkg.version);
type Operation = { security?: unknown; requestBody?: unknown; responses: Record<string, unknown> };
type Paths = Record<string, Record<string, Operation>>;
const paths = doc.paths as Paths;

describe('openapi.json', () => {
  it('file trong repo khớp hợp đồng hiện tại — đổi hợp đồng thì chạy `npm run openapi`', () => {
    const committed: unknown = JSON.parse(readFileSync(new URL('../openapi.json', import.meta.url), 'utf8'));
    expect(committed).toEqual(doc);
  });

  it('mọi route trong danh bạ đều có mặt', () => {
    for (const route of Object.values(routes)) {
      expect(paths[route.path]?.[route.method.toLowerCase()]).toBeDefined();
    }
  });

  it('route công khai không đòi token; route cần đăng nhập khai báo 401', () => {
    expect(paths['/v1/health']?.get?.security).toEqual([]);
    expect(paths['/v1/me']?.get?.security).toBeUndefined();
    expect(Object.keys(paths['/v1/me']?.get?.responses ?? {})).toContain('401');
  });

  it('route có thân request khai báo requestBody và 422', () => {
    const bootstrap = paths['/v1/me/bootstrap']?.post;
    expect(bootstrap?.requestBody).toBeDefined();
    expect(Object.keys(bootstrap?.responses ?? {})).toContain('422');
    expect(paths['/v1/me']?.get?.requestBody).toBeUndefined();
  });

  it('route tổ chức khai báo 403 và header X-Organization-Id', () => {
    const discover = paths['/v1/links/discover']?.post as Operation & { parameters?: { name: string }[] };
    expect(Object.keys(discover.responses)).toEqual(expect.arrayContaining(['401', '403', '422']));
    expect(discover.parameters?.map((p) => p.name)).toEqual(['X-Organization-Id']);
  });
});
