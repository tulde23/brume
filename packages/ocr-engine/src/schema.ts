import type { FieldSchema } from './types';

/** Convert our schema subset to standard JSON Schema for llama.cpp's grammar builder. */
export function toJsonSchema(schema: FieldSchema): object {
  switch (schema.type) {
    case 'object':
      return {
        type: 'object',
        properties: Object.fromEntries(
          Object.entries(schema.properties).map(([k, v]) => [k, toJsonSchema(v)]),
        ),
        required: schema.required ?? Object.keys(schema.properties),
        additionalProperties: false,
      };
    case 'array':
      return {
        type: 'array',
        items: toJsonSchema(schema.items),
        ...(schema.maxItems !== undefined ? { maxItems: schema.maxItems } : {}),
      };
    default: {
      const { nullable, description: _d, ...rest } = schema;
      return nullable ? { ...rest, type: [schema.type, 'null'] } : rest;
    }
  }
}

/** Describe the expected shape in plain text; small models follow an example better than a schema. */
export function describeSchema(schema: FieldSchema, indent = ''): string {
  switch (schema.type) {
    case 'object': {
      const inner = Object.entries(schema.properties)
        .map(([k, v]) => {
          const note = v.description ? ` // ${v.description}` : '';
          return `${indent}  "${k}": ${describeSchema(v, indent + '  ')}${note}`;
        })
        .join(',\n');
      return `{\n${inner}\n${indent}}`;
    }
    case 'array':
      return `[ ${describeSchema(schema.items, indent)}, ... ]`;
    default:
      return schema.nullable ? `${schema.type} or null` : schema.type;
  }
}

/**
 * Pull the first JSON value out of model output. Handles code fences and
 * chatter before/after the JSON, which grammar-free fallbacks can produce.
 */
export function extractJson(raw: string): unknown {
  const text = raw.replace(/```(?:json)?/gi, '').trim();
  try {
    return JSON.parse(text);
  } catch {
    // fall through to bracket scan
  }
  const start = text.search(/[[{]/);
  if (start < 0) throw new Error('No JSON found in model output');
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth++;
    else if (ch === close && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new Error('Unterminated JSON in model output');
}

const NULLISH = new Set(['', '-', '--', '—', 'n/a', 'na', 'none', 'null', '?']);

/**
 * Coerce parsed output to the schema: numeric strings become numbers, blanks
 * become null, out-of-range numbers are kept but reported. Never throws;
 * every fix is reported in `warnings` so the UI can flag it.
 */
export function coerce(
  schema: FieldSchema,
  value: unknown,
  path = '$',
  warnings: string[] = [],
): { value: unknown; warnings: string[] } {
  const out = coerceInner(schema, value, path, warnings);
  return { value: out, warnings };
}

function coerceInner(schema: FieldSchema, value: unknown, path: string, w: string[]): unknown {
  switch (schema.type) {
    case 'object': {
      const src = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
      if (src !== value) w.push(`${path}: expected object`);
      const obj: Record<string, unknown> = {};
      for (const [k, sub] of Object.entries(schema.properties)) {
        obj[k] = coerceInner(sub, (src as Record<string, unknown>)[k], `${path}.${k}`, w);
      }
      return obj;
    }
    case 'array': {
      if (!Array.isArray(value)) {
        if (value !== undefined && value !== null) w.push(`${path}: expected array`);
        return [];
      }
      return value.map((v, i) => coerceInner(schema.items, v, `${path}[${i}]`, w));
    }
    case 'integer':
    case 'number': {
      if (value === undefined || value === null) return null;
      let n: number;
      if (typeof value === 'number') n = value;
      else if (typeof value === 'string') {
        const s = value.trim().toLowerCase();
        if (NULLISH.has(s)) return null;
        const digits = s.replace(/[^0-9.-]/g, '');
        // "III" or "x" has no digits; Number('') would silently read it as 0.
        n = digits === '' ? NaN : Number(digits);
        if (s !== String(n)) w.push(`${path}: read "${value}" as ${n}`);
      } else n = NaN;
      if (!Number.isFinite(n)) {
        w.push(`${path}: not a number (${JSON.stringify(value)})`);
        return null;
      }
      if (schema.type === 'integer' && !Number.isInteger(n)) {
        w.push(`${path}: ${n} is not a whole number`);
        n = Math.round(n);
      }
      if (schema.minimum !== undefined && n < schema.minimum)
        w.push(`${path}: ${n} is below ${schema.minimum}`);
      if (schema.maximum !== undefined && n > schema.maximum)
        w.push(`${path}: ${n} is above ${schema.maximum}`);
      return n;
    }
    case 'boolean':
      if (typeof value === 'boolean') return value;
      if (value === 'true' || value === 'yes') return true;
      if (value === 'false' || value === 'no') return false;
      return null;
    case 'string': {
      if (value === undefined || value === null) return null;
      const s = String(value).trim();
      if (NULLISH.has(s.toLowerCase())) return null;
      if (schema.enum && !schema.enum.includes(s)) w.push(`${path}: "${s}" not one of ${schema.enum.join(', ')}`);
      return s;
    }
  }
}
