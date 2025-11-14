/**
 * Tests for AJV Error Formatter
 *
 * US13 (FR-12): Improved AJV Validation Error Messages
 * Validates user-friendly error formatting with actionable suggestions
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AjvErrorFormatter } from '../src/ajv-error-formatter.js';
import type { ErrorObject } from 'ajv';

describe('AjvErrorFormatter (US13: FR-12)', () => {
  let formatter: AjvErrorFormatter;

  beforeEach(() => {
    formatter = new AjvErrorFormatter();
  });

  /**
   * T130: AJV Error Parsing (Required Param Missing)
   *
   * ACCEPTANCE CRITERIA:
   * - Must parse AJV "required" keyword errors
   * - Must extract missing property name
   * - Must provide actionable suggestion for required params
   * - Must include field name and expected type
   */
  describe('Required Parameter Missing (T130)', () => {
    it('should_parseRequiredError_when_paramMissing', () => {
      const ajvErrors: ErrorObject[] = [
        {
          keyword: 'required',
          instancePath: '',
          schemaPath: '#/required',
          params: { missingProperty: 'model' },
          message: "must have required property 'model'",
        },
      ];

      const schema = {
        type: 'object',
        properties: {
          model: { type: 'string', description: 'Model identifier' },
        },
        required: ['model'],
      };

      const result = formatter.format(ajvErrors, schema, {});

      expect(result.userFriendly).toContain('Missing required parameter: model');
      expect(result.userFriendly).toContain('Model identifier');
      expect(result.suggestions).toHaveLength(1);
      expect(result.suggestions[0]).toContain('Add required parameter: model');
      expect(result.suggestions[0]).toContain('string');
    });

    it('should_parseMultipleRequiredErrors_when_multipleMissing', () => {
      const ajvErrors: ErrorObject[] = [
        {
          keyword: 'required',
          instancePath: '',
          schemaPath: '#/required',
          params: { missingProperty: 'prompt' },
          message: "must have required property 'prompt'",
        },
        {
          keyword: 'required',
          instancePath: '',
          schemaPath: '#/required',
          params: { missingProperty: 'models' },
          message: "must have required property 'models'",
        },
      ];

      const schema = {
        type: 'object',
        properties: {
          prompt: { type: 'string' },
          models: { type: 'array' },
        },
        required: ['prompt', 'models'],
      };

      const result = formatter.format(ajvErrors, schema, { temperature: 0.7 });

      expect(result.userFriendly).toContain('prompt');
      expect(result.userFriendly).toContain('models');
      expect(result.suggestions).toHaveLength(2);
    });
  });

  /**
   * T131: AJV Error Parsing (Incorrect Type)
   *
   * ACCEPTANCE CRITERIA:
   * - Must parse AJV "type" keyword errors
   * - Must extract expected type and actual type
   * - Must provide actionable suggestion for type mismatches
   * - Must detect number→string coercion opportunities
   */
  describe('Incorrect Type (T131)', () => {
    it('should_parseTypeError_when_wrongType', () => {
      const ajvErrors: ErrorObject[] = [
        {
          keyword: 'type',
          instancePath: '/temperature',
          schemaPath: '#/properties/temperature/type',
          params: { type: 'number' },
          message: 'must be number',
          data: '0.7',
        },
      ];

      const schema = {
        type: 'object',
        properties: {
          temperature: { type: 'number' },
        },
      };

      const result = formatter.format(ajvErrors, schema, { temperature: '0.7' });

      expect(result.userFriendly).toContain('temperature');
      expect(result.userFriendly).toContain('Expected: number');
      expect(result.userFriendly).toContain('Got: string');
      expect(result.suggestions).toHaveLength(1);
      expect(result.suggestions[0]).toContain('Remove quotes');
      expect(result.suggestions[0]).toContain('0.7');
    });

    it('should_suggestQuotes_when_numberProvidedForString', () => {
      const ajvErrors: ErrorObject[] = [
        {
          keyword: 'type',
          instancePath: '/model',
          schemaPath: '#/properties/model/type',
          params: { type: 'string' },
          message: 'must be string',
          data: 42,
        },
      ];

      const schema = {
        type: 'object',
        properties: {
          model: { type: 'string' },
        },
      };

      const result = formatter.format(ajvErrors, schema, { model: 42 });

      expect(result.userFriendly).toContain('model');
      expect(result.userFriendly).toContain('Expected: string');
      expect(result.userFriendly).toContain('Got: number');
      expect(result.suggestions).toHaveLength(1);
      expect(result.suggestions[0]).toContain('Wrap in quotes');
      expect(result.suggestions[0]).toContain('"42"');
    });

    it('should_suggestArrayConversion_when_singleValueProvidedForArray', () => {
      const ajvErrors: ErrorObject[] = [
        {
          keyword: 'type',
          instancePath: '/models',
          schemaPath: '#/properties/models/type',
          params: { type: 'array' },
          message: 'must be array',
          data: 'gpt-4',
        },
      ];

      const schema = {
        type: 'object',
        properties: {
          models: { type: 'array' },
        },
      };

      const result = formatter.format(ajvErrors, schema, { models: 'gpt-4' });

      expect(result.userFriendly).toContain('models');
      expect(result.userFriendly).toContain('Expected: array');
      expect(result.suggestions).toHaveLength(1);
      expect(result.suggestions[0]).toContain('Wrap in array brackets');
      expect(result.suggestions[0]).toContain('["gpt-4"]');
    });
  });

  /**
   * T132: User-Friendly Format with Suggestion
   *
   * ACCEPTANCE CRITERIA:
   * - Must include field name, expected type, actual value
   * - Must provide actionable "Try this..." suggestions
   * - Must format suggestions as executable code examples
   * - Must maintain backwards compatibility with raw AJV errors
   */
  describe('User-Friendly Format (T132)', () => {
    it('should_includeAllComponents_when_formattingError', () => {
      const ajvErrors: ErrorObject[] = [
        {
          keyword: 'type',
          instancePath: '/model',
          schemaPath: '#/properties/model/type',
          params: { type: 'string' },
          message: 'must be string',
          data: 42,
        },
      ];

      const schema = {
        type: 'object',
        properties: {
          model: { type: 'string', description: 'Model identifier' },
        },
      };

      const result = formatter.format(ajvErrors, schema, { model: 42 });

      // User-friendly message
      expect(result.userFriendly).toBeTruthy();
      expect(result.userFriendly).toContain('model'); // Field name
      expect(result.userFriendly).toContain('string'); // Expected type
      expect(result.userFriendly).toContain('42'); // Actual value
      expect(result.userFriendly).toContain('Model identifier'); // Description

      // Suggestions
      expect(result.suggestions).toBeTruthy();
      expect(result.suggestions.length).toBeGreaterThan(0);
      expect(result.suggestions[0]).toContain('Try:');
      expect(result.suggestions[0]).toContain('"42"'); // Executable fix

      // Backwards compatibility - raw AJV errors included
      expect(result.rawErrors).toBeTruthy();
      expect(result.rawErrors).toHaveLength(1);
      expect(result.rawErrors[0].keyword).toBe('type');
      expect(result.rawErrors[0].message).toBe('must be string');
    });

    it('should_formatEnum_when_invalidEnumValue', () => {
      const ajvErrors: ErrorObject[] = [
        {
          keyword: 'enum',
          instancePath: '/role',
          schemaPath: '#/properties/role/enum',
          params: { allowedValues: ['user', 'assistant', 'system'] },
          message: 'must be equal to one of the allowed values',
          data: 'admin',
        },
      ];

      const schema = {
        type: 'object',
        properties: {
          role: {
            type: 'string',
            enum: ['user', 'assistant', 'system'],
            description: 'Message role',
          },
        },
      };

      const result = formatter.format(ajvErrors, schema, { role: 'admin' });

      expect(result.userFriendly).toContain('role');
      expect(result.userFriendly).toContain('admin');
      expect(result.userFriendly).toContain('user');
      expect(result.userFriendly).toContain('assistant');
      expect(result.userFriendly).toContain('system');
      expect(result.suggestions).toHaveLength(1);
      expect(result.suggestions[0]).toContain('Choose one of');
    });

    it('should_formatPattern_when_regexMismatch', () => {
      const ajvErrors: ErrorObject[] = [
        {
          keyword: 'pattern',
          instancePath: '/email',
          schemaPath: '#/properties/email/pattern',
          params: { pattern: '^[^@]+@[^@]+$' },
          message: 'must match pattern "^[^@]+@[^@]+$"',
          data: 'notanemail',
        },
      ];

      const schema = {
        type: 'object',
        properties: {
          email: {
            type: 'string',
            pattern: '^[^@]+@[^@]+$',
            description: 'Email address',
          },
        },
      };

      const result = formatter.format(ajvErrors, schema, { email: 'notanemail' });

      expect(result.userFriendly).toContain('email');
      expect(result.userFriendly).toContain('notanemail');
      expect(result.suggestions).toHaveLength(1);
      expect(result.suggestions[0]).toContain('@');
    });
  });

  /**
   * Integration Tests
   */
  describe('Integration', () => {
    it('should_combineMultipleErrors_when_severalIssues', () => {
      const ajvErrors: ErrorObject[] = [
        {
          keyword: 'required',
          instancePath: '',
          schemaPath: '#/required',
          params: { missingProperty: 'prompt' },
          message: "must have required property 'prompt'",
        },
        {
          keyword: 'type',
          instancePath: '/temperature',
          schemaPath: '#/properties/temperature/type',
          params: { type: 'number' },
          message: 'must be number',
          data: '0.7',
        },
        {
          keyword: 'additionalProperties',
          instancePath: '',
          schemaPath: '#/additionalProperties',
          params: { additionalProperty: 'invalidParam' },
          message: 'must NOT have additional properties',
        },
      ];

      const schema = {
        type: 'object',
        properties: {
          prompt: { type: 'string' },
          temperature: { type: 'number' },
        },
        required: ['prompt'],
        additionalProperties: false,
      };

      const result = formatter.format(ajvErrors, schema, { temperature: '0.7', invalidParam: true });

      // Should include all error types
      expect(result.userFriendly).toContain('prompt');
      expect(result.userFriendly).toContain('temperature');
      expect(result.userFriendly).toContain('invalidParam');

      // Should have suggestions for fixable errors
      expect(result.suggestions.length).toBeGreaterThanOrEqual(2);

      // Should preserve all raw errors
      expect(result.rawErrors).toHaveLength(3);
    });
  });
});
