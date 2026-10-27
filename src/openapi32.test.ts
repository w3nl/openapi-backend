import { OpenAPIBackend, Document } from './backend';

function documentWithFields(openapi: string, extra: Record<string, unknown> = {}): Document {
  return {
    openapi,
    info: { title: 'OpenAPI 3.2 compatibility probes', version: '1.0.0' },
    paths: {},
    ...extra,
  } as Document;
}

describe.each(['3.2.0', '3.2.1'])('OpenAPI %s new feature probes', (openapi) => {
  const operation = { operationId: 'probe', responses: { 200: { description: 'OK' } } };
  const fields: [string, Record<string, unknown>][] = [
    ['$self', { $self: 'https://example.com/openapi' }],
    ['server name', { servers: [{ url: 'https://example.com', name: 'production' }] }],
    ['tag summary', { tags: [{ name: 'parent', summary: 'Parent' }] }],
    ['tag parent', { tags: [{ name: 'parent' }, { name: 'child', parent: 'parent' }] }],
    ['tag kind', { tags: [{ name: 'public', kind: 'audience' }] }],
    ['QUERY', { paths: { '/probe': { query: operation } } }],
    ['additionalOperations', { paths: { '/probe': { additionalOperations: { COPY: operation } } } }],
    ['querystring', { paths: { '/probe': { get: { ...operation, parameters: [{ name: 'query', in: 'querystring', content: { 'application/x-www-form-urlencoded': { schema: { type: 'object' } } } }] } } } }],
    ['cookie style', { paths: { '/probe': { get: { ...operation, parameters: [{ name: 'token', in: 'cookie', style: 'cookie', schema: { type: 'string' } }] } } } }],
    ['components.mediaTypes', { components: { mediaTypes: { JSON: { schema: { type: 'integer' } } } } }],
    ['itemSchema', { paths: { '/probe': { post: { ...operation, requestBody: { content: { 'application/x-ndjson': { itemSchema: { type: 'integer' } } } } } } } }],
    ['prefixEncoding', { paths: { '/probe': { post: { ...operation, requestBody: { content: { 'multipart/mixed': { schema: { type: 'array', items: {} }, prefixEncoding: [{ contentType: 'application/json' }] } } } } } } }],
    ['itemEncoding', { paths: { '/probe': { post: { ...operation, requestBody: { content: { 'multipart/mixed': { itemSchema: {}, itemEncoding: { contentType: 'application/json' } } } } } } } }],
    ['nested encoding', { paths: { '/probe': { post: { ...operation, requestBody: { content: { 'multipart/form-data': { schema: { type: 'object' }, encoding: { nested: { contentType: 'multipart/mixed', itemEncoding: { contentType: 'application/json' } } } } } } } } } }],
    ['response summary', { components: { responses: { OK: { description: 'OK', summary: 'Success' } } } }],
    ['optional response description', { components: { responses: { OK: {} } } }],
    ['dataValue', { components: { examples: { Example: { dataValue: { value: 1 } } } } }],
    ['serializedValue', { components: { examples: { Example: { serializedValue: 'value=1' } } } } }],
    ['XML nodeType', { components: { schemas: { Value: { type: 'string', xml: { nodeType: 'cdata' } } } } }],
    ['defaultMapping', { components: { schemas: { Value: { oneOf: [{ type: 'string' }, { type: 'number' }], discriminator: { propertyName: 'kind', defaultMapping: 'Other' } }, Other: { type: 'number' } } } }],
    ['OAuth metadata', { components: { securitySchemes: { auth: { type: 'oauth2', oauth2MetadataUrl: 'https://example.com/metadata', flows: { clientCredentials: { tokenUrl: 'https://example.com/token', scopes: {} } } } } } }],
    ['security deprecation', { components: { securitySchemes: { auth: { type: 'http', scheme: 'basic', deprecated: true } } } }],
    ['device authorization', { components: { securitySchemes: { auth: { type: 'oauth2', flows: { deviceAuthorization: { deviceAuthorizationUrl: 'https://example.com/device', tokenUrl: 'https://example.com/token', scopes: {} } } } } } }],
  ];

  test.each(fields)('characterizes new document field: %s', async (name, extra) => {
    const api = new OpenAPIBackend({ definition: documentWithFields(openapi, extra), strict: true });
    await api.loadDocument();
    if (name === 'querystring' || name === 'cookie style') {
      expect(api.validateDefinition()).toBe(api.document);
    } else {
      expect(() => api.validateDefinition()).toThrow('Document is not valid OpenAPI');
    }
  });

  test('a version label alone passes normal strict startup', async () => {
    const api = new OpenAPIBackend({ definition: documentWithFields(openapi, { paths: { '/probe': { post: operation } } }), strict: true });
    await expect(api.init()).resolves.toBe(api);
  });

  test.each([
    ['QUERY', { query: operation }],
    ['COPY', { additionalOperations: { COPY: operation } }],
  ])('%s operations are not discovered even in quick mode', async (method, pathItem) => {
    const api = new OpenAPIBackend({ definition: documentWithFields(openapi, { paths: { '/probe': pathItem } }), strict: true, quick: true });
    await api.init();
    expect(api.getOperations()).toEqual([]);
    expect(api.matchOperation({ method, path: '/probe', headers: {} })).toBeUndefined();
  });

  test('querystring parameter validator cannot be built even in quick mode', async () => {
    const extra = fields.find(([name]) => name === 'querystring')![1];
    const api = new OpenAPIBackend({ definition: documentWithFields(openapi, extra), strict: true, quick: true });
    await api.init();
    expect(() => api.validateRequest({ method: 'get', path: '/probe?value=1', headers: {} })).toThrow(TypeError);
  });

  test.each(['application/x-ndjson', 'text/event-stream'])('%s itemSchema is not enforced in quick mode', async (mediaType) => {
    const content = { [mediaType]: { itemSchema: { type: 'integer' } } };
    const api = new OpenAPIBackend({ definition: documentWithFields(openapi, { paths: { '/probe': { post: {
      ...operation, requestBody: { content }, responses: { 200: { description: 'OK', content } },
    } } } }), strict: true, quick: true });
    await api.init();
    expect(api.validateRequest({ method: 'post', path: '/probe', headers: { 'content-type': mediaType }, body: 'not an integer' }).valid).toBe(true);
    expect(api.validateResponse('not an integer', 'probe', 200).valid).toBe(true);
  });

  test.each([
    ['if/then/else', { if: { properties: { kind: { enum: ['business'] } }, required: ['kind'] }, then: { required: ['company'] }, else: { required: ['name'] } }, { kind: 'business', company: 'Acme' }, { kind: 'business' }, false],
    ['unevaluatedProperties', { unevaluatedProperties: false }, {}, { unexpected: true }, true],
    ['dependentRequired', { dependentRequired: { first: ['second'] } }, { first: 1, second: 2 }, { first: 1 }, true],
  ])('inherits schema behavior: %s', async (_name, schema, validBody, invalidBody, invalidAccepted) => {
    const content = { 'application/json': { schema } };
    const definition = documentWithFields(openapi, { paths: { '/probe': { post: { ...operation, requestBody: { content }, responses: { 200: { description: 'OK', content } } } } } });
    const normal = new OpenAPIBackend({ definition, strict: true });
    await expect(normal.init()).rejects.toThrow('Document is not valid OpenAPI');
    const api = new OpenAPIBackend({ definition, strict: true, quick: true });
    await api.init();
    for (const [body, expected] of [[validBody, true], [invalidBody, invalidAccepted]] as const) {
      expect(api.validateRequest({ method: 'post', path: '/probe', headers: { 'content-type': 'application/json' }, body }).valid).toBe(expected);
      expect(api.validateResponse(body, 'probe', 200).valid).toBe(expected);
    }
  });
});