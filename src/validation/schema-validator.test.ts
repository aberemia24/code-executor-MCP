/**
 * Comprehensive tests for SchemaValidator
 */

import { describe, it, expect } from 'vitest';
import { SchemaValidator } from './schema-validator.js';
import type { CachedToolSchema } from './schema-cache.js';

describe('SchemaValidator', () => {
  const validator = new SchemaValidator();

  describe('Basic validation', () => {
    const schema: CachedToolSchema = {
      name: 'test_tool',
      inputSchema: {
        type: 'object',
        properties: {
          message: { type: 'string' },
          count: { type: 'integer' },
        },
        required: ['message', 'count'],
      },
    };

    it('should accept valid params', () => {
      const result = validator.validate(
        { message: 'hello', count: 5 },
        schema
      );
      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should detect missing required params', () => {
      const result = validator.validate({ message: 'hello' }, schema);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required parameter: count');
      expect(result.missing).toContain('count');
    });

    it('should detect type mismatches', () => {
      const result = validator.validate(
        { message: 'hello', count: 'five' },
        schema
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/Type mismatch.*count.*integer/),
        ])
      );
    });

    it('should detect unexpected params when additionalProperties: false', () => {
      const strictSchema: CachedToolSchema = {
        name: 'strict_tool',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
          },
          required: ['name'],
          additionalProperties: false,
        },
      };

      const result = validator.validate(
        { name: 'test', extra: 'oops' },
        strictSchema
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/Unexpected parameter.*extra/),
        ])
      );
      expect(result.unexpected).toContain('extra');
    });
  });

  describe('Nested object validation', () => {
    const schema: CachedToolSchema = {
      name: 'nested_tool',
      inputSchema: {
        type: 'object',
        properties: {
          config: {
            type: 'object',
            properties: {
              timeout: { type: 'number' },
              retries: { type: 'integer' },
            },
            required: ['timeout'],
          },
        },
        required: ['config'],
      },
    };

    it('should validate nested objects', () => {
      const result = validator.validate(
        { config: { timeout: 5000, retries: 3 } },
        schema
      );
      expect(result.valid).toBe(true);
    });

    it('should detect missing nested required fields', () => {
      const result = validator.validate({ config: { retries: 3 } }, schema);
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/timeout/),
        ])
      );
    });

    it('should detect type mismatches in nested fields', () => {
      const result = validator.validate(
        { config: { timeout: 'slow', retries: 3 } },
        schema
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/config\.timeout.*number/i),
        ])
      );
    });
  });

  describe('Array validation', () => {
    const schema: CachedToolSchema = {
      name: 'array_tool',
      inputSchema: {
        type: 'object',
        properties: {
          tags: {
            type: 'array',
            items: { type: 'string' },
          },
        },
        required: ['tags'],
      },
    };

    it('should validate arrays with correct item types', () => {
      const result = validator.validate({ tags: ['a', 'b', 'c'] }, schema);
      expect(result.valid).toBe(true);
    });

    it('should detect incorrect array item types', () => {
      const result = validator.validate({ tags: ['a', 2, 'c'] }, schema);
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/type.*string/i),
        ])
      );
    });

    it('should reject non-arrays when array expected', () => {
      const result = validator.validate({ tags: 'not-an-array' }, schema);
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/type.*array/i),
        ])
      );
    });
  });

  describe('Enum validation', () => {
    const schema: CachedToolSchema = {
      name: 'enum_tool',
      inputSchema: {
        type: 'object',
        properties: {
          level: {
            type: 'string',
            enum: ['low', 'medium', 'high'],
          },
        },
        required: ['level'],
      },
    };

    it('should accept valid enum values', () => {
      const result = validator.validate({ level: 'high' }, schema);
      expect(result.valid).toBe(true);
    });

    it('should reject invalid enum values', () => {
      const result = validator.validate({ level: 'extreme' }, schema);
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/must be one of.*low.*medium.*high/),
        ])
      );
    });
  });

  describe('Constraint validation', () => {
    const schema: CachedToolSchema = {
      name: 'constraint_tool',
      inputSchema: {
        type: 'object',
        properties: {
          age: {
            type: 'integer',
            minimum: 0,
            maximum: 120,
          },
          name: {
            type: 'string',
            minLength: 1,
            maxLength: 50,
          },
          email: {
            type: 'string',
            pattern: '^[^@]+@[^@]+\\.[^@]+$',
          },
        },
        required: ['age', 'name'],
      },
    };

    it('should accept values within constraints', () => {
      const result = validator.validate(
        { age: 25, name: 'John', email: 'john@example.com' },
        schema
      );
      expect(result.valid).toBe(true);
    });

    it('should reject values below minimum', () => {
      const result = validator.validate({ age: -1, name: 'John' }, schema);
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/>=/), // AJV format: "must be >= 0"
        ])
      );
    });

    it('should reject values above maximum', () => {
      const result = validator.validate({ age: 150, name: 'John' }, schema);
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/<=/), // AJV format: "must be <= 120"
        ])
      );
    });

    it('should reject strings below minLength', () => {
      const result = validator.validate({ age: 25, name: '' }, schema);
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/fewer than.*characters/i),
        ])
      );
    });

    it('should reject strings above maxLength', () => {
      const result = validator.validate(
        { age: 25, name: 'a'.repeat(51) },
        schema
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/more than.*characters/i),
        ])
      );
    });

    it('should reject strings not matching pattern', () => {
      const result = validator.validate(
        { age: 25, name: 'John', email: 'not-an-email' },
        schema
      );
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/pattern/i),
        ])
      );
    });
  });

  describe('Integer vs Number distinction', () => {
    const schema: CachedToolSchema = {
      name: 'int_tool',
      inputSchema: {
        type: 'object',
        properties: {
          step: { type: 'integer' },
          ratio: { type: 'number' },
        },
        required: ['step', 'ratio'],
      },
    };

    it('should accept integers for integer type', () => {
      const result = validator.validate({ step: 1, ratio: 0.5 }, schema);
      expect(result.valid).toBe(true);
    });

    it('should reject floats for integer type', () => {
      const result = validator.validate({ step: 1.5, ratio: 0.5 }, schema);
      expect(result.valid).toBe(false);
      expect(result.errors).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/step.*integer/),
        ])
      );
    });

    it('should accept floats for number type', () => {
      const result = validator.validate({ step: 1, ratio: 0.75 }, schema);
      expect(result.valid).toBe(true);
    });
  });

  describe('formatError', () => {
    const schema: CachedToolSchema = {
      name: 'test_tool',
      description: 'A test tool',
      inputSchema: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'The message to send',
          },
          count: {
            type: 'integer',
            description: 'Number of times to repeat',
          },
          optional: {
            type: 'boolean',
            description: 'Optional flag',
          },
        },
        required: ['message', 'count'],
      },
    };

    it('should format error with schema details', () => {
      const params = { message: 'hello' };
      const result = validator.validate(params, schema);
      const error = validator.formatError('test_tool', params, schema, result);

      expect(error).toContain('Parameter validation failed for "test_tool"');
      expect(error).toContain('Missing required parameter: count');
      expect(error).toContain('Required:');
      expect(error).toContain('message: string');
      expect(error).toContain('count: integer');
      expect(error).toContain('Optional:');
      expect(error).toContain('optional: boolean');
      expect(error).toContain('You provided:');
      expect(error).toContain(JSON.stringify(params, null, 2));
    });
  });
});
