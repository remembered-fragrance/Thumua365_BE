/**
 * Sinh tài liệu OpenAPI 3.1 từ `routes` — không viết tay, không decorator.
 * File kết quả `openapi.json` được commit: đổi hợp đồng thì diff hiện trong PR,
 * và `npm run mock` (Prism) phục vụ frontend từ đúng file này.
 */

import { z } from 'zod';
import { ERROR_STATUS, ErrorBody } from './errors.js';
import { pathParamNames, routes, type RouteDef } from './routes.js';

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
  if (route.auth === 'admin') statuses.add(ERROR_STATUS.FORBIDDEN);
  if (route.body || route.query || route.params) statuses.add(ERROR_STATUS.VALIDATION_FAILED);
  for (const code of route.errors ?? []) statuses.add(ERROR_STATUS[code]);
  return [...statuses].sort((a, b) => a - b);
};

/** Mỗi trường của schema query/params thành một tham số `in: query` / `in: path`. */
const fieldParameters = (schemaDef: z.ZodType | undefined, where: 'query' | 'path'): JsonObject[] => {
  if (!schemaDef) return [];
  const schema = schemaOf(schemaDef, 'input') as { properties?: Record<string, JsonObject>; required?: string[] };
  return Object.entries(schema.properties ?? {}).map(([name, property]) => ({
    name,
    in: where,
    required: where === 'path' || (schema.required?.includes(name) ?? false),
    schema: property,
  }));
};

/** `/v1/links/:id/accept` → `/v1/links/{id}/accept` (cú pháp của OpenAPI). */
const openApiPath = (path: string): string => {
  let out = path;
  for (const name of pathParamNames(path)) out = out.replace(`:${name}`, `{${name}}`);
  return out;
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
  parameters.push(...fieldParameters(route.params, 'path'), ...fieldParameters(route.query, 'query'));

  const body = route.docBody ?? route.body;

  return {
    operationId: name,
    summary: route.summary,
    ...(route.auth === 'public' ? { security: [] } : {}),
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(body
      ? {
          requestBody: {
            required: true,
            content: { 'application/json': { schema: schemaOf(body, 'input') } },
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
    const path = openApiPath(route.path);
    paths[path] = { ...(paths[path] ?? {}), [route.method.toLowerCase()]: operation(name, route) };
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
