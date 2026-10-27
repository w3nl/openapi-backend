import { OpenAPIBackend, Document } from './backend';

function documentWithSchema(openapi: string, schema: unknown): Document {
  return {
    openapi,
    info: { title: 'OpenAPI compatibility probes', version: '1.0.0' },
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
  const cases: [string, unknown, boolean, unknown, unknown, boolean][] = [
    ['null type', { type: 'null' }, true, null, 1, false],
    ['type union', { type: ['string', 'null'] }, false, null, 1, false],
    ['boolean true', true, false, {}, 1, true],
    ['boolean false is skipped', false, false, {}, 1, true],
    ['nested false', { properties: { blocked: false } }, false, {}, { blocked: 1 }, false],
    ['const', { const: 'yes' }, false, 'yes', 'no', false],
    ['exclusiveMinimum', { type: 'number', exclusiveMinimum: 2 }, true, 3, 2, false],
    ['exclusiveMaximum', { type: 'number', exclusiveMaximum: 2 }, true, 1, 2, false],
    ['contains', { type: 'array', contains: { type: 'number' } }, false, [1], ['x'], false],
    ['minContains is ignored', { contains: { type: 'number' }, minContains: 2 }, false, [1, 2], [1], true],
    ['maxContains is ignored', { contains: { type: 'number' }, maxContains: 1 }, false, [1], [1, 2], true],
    ['prefixItems is ignored', { prefixItems: [{ type: 'number' }] }, false, [1], ['x'], true],
    ['dependentRequired is ignored', { dependentRequired: { first: ['second'] } }, false, { first: 1, second: 2 }, { first: 1 }, true],
    ['dependentSchemas is ignored', { dependentSchemas: { first: { required: ['second'] } } }, false, { first: 1, second: 2 }, { first: 1 }, true],
    ['unevaluatedItems is ignored', { unevaluatedItems: false }, false, [], [1], true],
    ['propertyNames', { propertyNames: { pattern: '^allowed' } }, false, { allowed: 1 }, { other: 1 }, false],
    ['patternProperties', { patternProperties: { '^allowed': { type: 'number' } } }, false, { allowed: 1 }, { allowed: 'x' }, false],
    ['dynamic references are ignored', { $defs: { value: { $dynamicAnchor: 'value', type: 'string' } }, properties: { value: { $dynamicRef: '#value' } } }, false, { value: 'x' }, { value: 1 }, true],
    ['schema examples', { type: 'string', examples: ['x'] }, false, 'x', 1, false],
    ['arbitrary annotations', { type: 'string', customAnnotation: 'note' }, false, 'x', 1, false],
    ['content annotations', { type: 'string', contentEncoding: 'base64', contentMediaType: 'application/json', contentSchema: { type: 'object' } }, false, 'e30=', 'not base64', true],
    ['if then else', { if: { type: 'string' }, then: { minLength: 2 }, else: { type: 'number' } }, false, 'ok', 'x', false],
  ];

  test('a version label alone is accepted without proving dialect support', async () => {
    const api = new OpenAPIBackend({ definition: documentWithSchema(openapi, { type: 'object' }), strict: true });
    await expect(api.init()).resolves.toBe(api);
  });

  test.each(cases)('characterizes document acceptance: %s', async (_name, schema, accepted) => {
    const api = new OpenAPIBackend({ definition: documentWithSchema(openapi, schema), strict: true });
    await api.loadDocument();
    if (accepted) {
      expect(api.validateDefinition()).toBe(api.document);
    } else {
      expect(() => api.validateDefinition()).toThrow('Document is not valid OpenAPI');
    }
  });

  test.each(cases)('characterizes runtime behavior after explicit bypass: %s', async (_name, schema, _accepted, validBody, invalidBody, invalidAccepted) => {
    const api = new OpenAPIBackend({ definition: documentWithSchema(openapi, schema), strict: true, quick: true });
    await api.init();
    for (const [body, expected] of [[validBody, true], [invalidBody, invalidAccepted]] as const) {
      expect(api.validateRequest({
        method: 'post', path: '/probe', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      }).valid).toBe(expected);
      expect(api.validateResponse(body, 'probe', 200).valid).toBe(expected);
    }
  });

  test.each(['https://json-schema.org/draft/2020-12/schema', 'https://spec.openapis.org/oas/3.1/dialect/base'])(
    'explicit dialect %s is ignored in wrapped requests but fails for response roots', async ($schema) => {
      const api = new OpenAPIBackend({ definition: documentWithSchema(openapi, { $schema, type: 'string' }), strict: true, quick: true });
      await api.init();
      expect(api.validateRequest({ method: 'post', path: '/probe', headers: {}, body: {} }).valid).toBe(false);
      expect(() => api.validateResponse('value', 'probe', 200)).toThrow('no schema with key or ref');
    },
  );

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
