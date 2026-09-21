/**
 * Sinh tài liệu OpenAPI 3.1 từ `routes` — không viết tay, không decorator.
 * File kết quả `openapi.json` được commit: đổi hợp đồng thì diff hiện trong PR,
 * và `npm run mock` (Prism) phục vụ frontend từ đúng file này.
 */

import { z } from 'zod';
import { ERROR_STATUS, ErrorBody } from './errors.js';
import { routes, type RouteDef } from './routes.js';

type JsonObject = Record<string, unknown>;

/** JSON Schema của zod kèm khoá `$schema` — thừa khi nằm trong tài liệu OpenAPI. */
const schemaOf = (schema: z.ZodType, io: 'input' | 'output' = 'output'): JsonObject => {
  const { $schema: _, ...rest } = z.toJSONSchema(schema, { io }) as JsonObject;
  return rest;
};

const errorResponse = (description: string): JsonObject => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorBody' } } },
});

/** Mã lỗi có thể gặp ở mọi endpoint theo loại xác thực. */
const errorStatuses = (route: RouteDef): number[] => {
  const statuses = new Set<number>([ERROR_STATUS.RATE_LIMITED, ERROR_STATUS.INTERNAL]);
  if (route.auth !== 'public') statuses.add(ERROR_STATUS.UNAUTHENTICATED);
  if (route.auth === 'org') {
    statuses.add(ERROR_STATUS.FORBIDDEN);
    statuses.add(ERROR_STATUS.VALIDATION_FAILED); // header X-Organization-Id thiếu hoặc sai
  }
  if (route.body) statuses.add(ERROR_STATUS.VALIDATION_FAILED);
  for (const code of route.errors ?? []) statuses.add(ERROR_STATUS[code]);
  return [...statuses].sort((a, b) => a - b);
};

const operation = (name: string, route: RouteDef): JsonObject => {
  const responses: JsonObject = {
    '200': {
      description: 'OK',
      content: { 'application/json': { schema: schemaOf(route.response) } },
    },
  };
  for (const status of errorStatuses(route)) responses[String(status)] = errorResponse('Lỗi — xem `error.code`');

  const parameters: JsonObject[] = [];
  if (route.auth === 'org') {
    parameters.push({
      name: 'X-Organization-Id',
      in: 'header',
      required: true,
      schema: { type: 'string', format: 'uuid' },
    });
  }

  return {
    operationId: name,
    summary: route.summary,
    ...(route.auth === 'public' ? { security: [] } : {}),
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(route.body
      ? {
          requestBody: {
            required: true,
            content: { 'application/json': { schema: schemaOf(route.body, 'input') } },
          },
        }
      : {}),
    ...(route.permission ? { 'x-permission': route.permission } : {}),
    ...(route.errors ? { 'x-error-codes': route.errors } : {}),
    ...(route.rateLimitPerMinute ? { 'x-rate-limit-per-minute': route.rateLimitPerMinute } : {}),
    responses,
  };
};

export const buildOpenApi = (version: string): JsonObject => {
  const paths: Record<string, JsonObject> = {};
  for (const [name, route] of Object.entries(routes) as [string, RouteDef][]) {
    paths[route.path] = { ...(paths[route.path] ?? {}), [route.method.toLowerCase()]: operation(name, route) };
  }

  return {
    openapi: '3.1.0',
    info: { title: 'THUMUA365 API', version },
    servers: [
      { url: 'https://api.thumua365.vn', description: 'production' },
      { url: 'https://api-staging.thumua365.vn', description: 'staging' },
    ],
    security: [{ bearer: [] }],
    paths,
    components: {
      securitySchemes: {
        bearer: { type: 'http', scheme: 'bearer', description: 'access_token của Supabase Auth' },
      },
      schemas: { ErrorBody: schemaOf(ErrorBody) },
    },
  };
};
