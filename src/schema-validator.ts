/**
 * Schema Validator Module
 *
 * Validates tool call parameters against JSON schemas using AJV.
 * Provides deep recursive validation with clear, actionable error messages.
 */

import { Ajv } from 'ajv';
import type { CachedToolSchema } from './schema-cache.js';

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
  missing?: string[];
  unexpected?: string[];
  typeMismatch?: Array<{ param: string; expected: string; got: string }>;
}

export class SchemaValidator {
  private ajv: Ajv;

  constructor() {
    // Initialize AJV with strict mode for comprehensive validation
    this.ajv = new Ajv({
      allErrors: true, // Collect all errors, not just the first one
      strict: false, // Allow JSON Schema features not in strict mode
      validateFormats: true, // Validate string formats (email, uri, etc.)
      verbose: true, // Include schema and data in errors
    });
  }

  /**
   * Validate parameters against a tool schema using AJV (deep, recursive validation)
   */
  validate(params: unknown, schema: CachedToolSchema): ValidationResult {
    // Use AJV to validate against the JSON Schema
    const validate = this.ajv.compile(schema.inputSchema);
    const valid = validate(params);

    if (valid) {
      return { valid: true };
    }

    // Parse AJV errors into our format
    const errors: string[] = [];
    const missing: string[] = [];
    const unexpected: string[] = [];
    const typeMismatch: Array<{ param: string; expected: string; got: string }> = [];

    for (const error of validate.errors || []) {
      const paramPath = error.instancePath.replace(/^\//, '').replace(/\//g, '.');
      const paramName = paramPath || 'root';

      switch (error.keyword) {
        case 'required':
          missing.push(error.params.missingProperty);
          errors.push(`Missing required parameter: ${error.params.missingProperty}`);
          break;

        case 'additionalProperties':
          unexpected.push(error.params.additionalProperty);
          errors.push(`Unexpected parameter: ${error.params.additionalProperty}`);
          break;

        case 'type':
          typeMismatch.push({
            param: paramName,
            expected: error.params.type,
            got: typeof error.data,
          });
          errors.push(
            `Type mismatch for "${paramName}": expected ${error.params.type}, got ${typeof error.data}`
          );
          break;

        case 'enum':
          errors.push(
            `Invalid value for "${paramName}": must be one of ${JSON.stringify(error.params.allowedValues)}`
          );
          break;

        case 'minimum':
        case 'maximum':
        case 'minLength':
        case 'maxLength':
        case 'pattern':
          errors.push(`${error.message} for "${paramName}"`);
          break;

        default:
          // Generic error for other validation failures
          errors.push(error.message || `Validation failed for "${paramName}"`);
      }
    }

    return {
      valid: false,
      errors,
      missing: missing.length > 0 ? missing : undefined,
      unexpected: unexpected.length > 0 ? unexpected : undefined,
      typeMismatch: typeMismatch.length > 0 ? typeMismatch : undefined,
    };
  }

  /**
   * Generate a human-readable error message
   */
  formatError(toolName: string, params: unknown, schema: CachedToolSchema, result: ValidationResult): string {
    const lines: string[] = [];

    lines.push(`\nParameter validation failed for "${toolName}"\n`);

    // Show errors
    if (result.errors) {
      lines.push('Errors:');
      for (const error of result.errors) {
        lines.push(`  - ${error}`);
      }
      lines.push('');
    }

    // Show schema
    const properties = schema.inputSchema.properties || {};
    const required = schema.inputSchema.required || [];

    lines.push('Expected parameters:');

    // Required params
    if (required.length > 0) {
      lines.push('  Required:');
      for (const param of required) {
        const propSchema = properties[param];
        const typeInfo = propSchema?.type || 'any';
        const desc = propSchema?.description ? ` - ${propSchema.description}` : '';
        lines.push(`    • ${param}: ${typeInfo}${desc}`);
      }
    }

    // Optional params
    const optional = Object.keys(properties).filter(p => !required.includes(p));
    if (optional.length > 0) {
      lines.push('  Optional:');
      for (const param of optional) {
        const propSchema = properties[param];
        const typeInfo = propSchema?.type || 'any';
        const desc = propSchema?.description ? ` - ${propSchema.description}` : '';
        lines.push(`    • ${param}: ${typeInfo}${desc}`);
      }
    }

    // Show what was provided
    lines.push('');
    lines.push('You provided:');
    lines.push(`  ${JSON.stringify(params, null, 2)}`);

    return lines.join('\n');
  }

}
