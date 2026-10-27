import { OpenAPIBackend, Document } from './backend';

function documentWithSchema(openapi: string, schema: unknown): Document {
  return {
    openapi,
    info: { title: 'OpenAPI 3.1 compatibility probes', version: '1.0.0' },
    paths: {
      '/probe': {
        post: {
          operationId: 'probe',
          requestBody: { content: { 'application/json': { schema } } },
          responses: { 200: { description: 'OK', content: { 'application/json': { schema } } } },
        },
      },
    },
  } as Document;
}

describe.each(['3.1.0', '3.1.1', '3.1.2'])('OpenAPI %s compatibility probes', (openapi) => {
  test('unevaluatedProperties is rejected by document validation', async () => {
    const api = new OpenAPIBackend({
      definition: documentWithSchema(openapi, { type: 'object', unevaluatedProperties: false }),
      strict: true,
    });
    await expect(api.init()).rejects.toThrow('"additionalProperty": "unevaluatedProperties"');
  });

  test('unevaluatedProperties is silently ignored by default runtime validation in quick mode', async () => {
    const api = new OpenAPIBackend({
      definition: documentWithSchema(openapi, { type: 'object', unevaluatedProperties: false }),
      strict: true,
      quick: true,
    });
    await api.init();
    const body = { unexpected: true };
    expect(api.validateRequest({ method: 'post', path: '/probe', headers: {}, body }).valid).toBe(true);
    expect(api.validateResponse(body, 'probe', 200).valid).toBe(true);
  });
});