import { coerce, extractJson, toJsonSchema } from '../schema';
import type { FieldSchema } from '../types';

describe('extractJson', () => {
  it('parses plain JSON', () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('strips code fences and surrounding chatter', () => {
    expect(extractJson('Sure! ```json\n{"a": [1, 2]}\n``` hope that helps')).toEqual({ a: [1, 2] });
  });

  it('ignores braces inside strings when scanning', () => {
    expect(extractJson('note: {"name": "x}y", "n": 2} trailing')).toEqual({ name: 'x}y', n: 2 });
  });

  it('throws when there is no JSON', () => {
    expect(() => extractJson('I cannot read this image.')).toThrow('No JSON');
  });
});

describe('toJsonSchema', () => {
  it('marks every property required, forbids extras, and expands nullable', () => {
    const schema: FieldSchema = {
      type: 'object',
      properties: { n: { type: 'integer', nullable: true, minimum: 0, description: 'x' } },
    };
    expect(toJsonSchema(schema)).toEqual({
      type: 'object',
      properties: { n: { type: ['integer', 'null'], minimum: 0 } },
      required: ['n'],
      additionalProperties: false,
    });
  });
});

describe('coerce', () => {
  const player: FieldSchema = {
    type: 'object',
    properties: {
      number: { type: 'string', nullable: true },
      fouls: { type: 'integer', nullable: true, minimum: 0, maximum: 6 },
    },
  };

  it('turns numeric strings into numbers and reports it', () => {
    const { value, warnings } = coerce(player, { number: 23, fouls: '3 ' });
    expect(value).toEqual({ number: '23', fouls: 3 });
    expect(warnings).toEqual([]);
  });

  it('treats dashes and blanks as null', () => {
    expect(coerce(player, { number: '-', fouls: '—' }).value).toEqual({ number: null, fouls: null });
  });

  it('keeps out-of-range numbers but warns', () => {
    const { value, warnings } = coerce(player, { number: '5', fouls: 9 });
    expect(value).toEqual({ number: '5', fouls: 9 });
    expect(warnings).toEqual(['$.fouls: 9 is above 6']);
  });

  it('nulls garbage numbers and warns with the path', () => {
    const { value, warnings } = coerce({ type: 'array', items: player }, [{ number: '1', fouls: 'III' }]);
    expect(value).toEqual([{ number: '1', fouls: null }]);
    expect(warnings[0]).toMatch(/^\$\[0\]\.fouls/);
  });

  it('fills missing object fields with null', () => {
    expect(coerce(player, {}).value).toEqual({ number: null, fouls: null });
  });
});
