/**
 * Schema Validator Module
 *
 * Validates tool call parameters against JSON schemas.
 * Provides clear, actionable error messages when validation fails.
 */

import type { ToolSchema } from './schema-cache.js';

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
  missing?: string[];
  unexpected?: string[];
  typeMismatch?: Array<{ param: string; expected: string; got: string }>;
}

export class SchemaValidator {
  /**
   * Validate parameters against a tool schema
   */
  validate(params: any, schema: ToolSchema): ValidationResult {
    const errors: string[] = [];
    const missing: string[] = [];
    const unexpected: string[] = [];
    const typeMismatch: Array<{ param: string; expected: string; got: string }> = [];

    const inputSchema = schema.inputSchema;
    const properties = inputSchema.properties || {};
    const required = inputSchema.required || [];

    // Check for missing required parameters
    for (const requiredParam of required) {
      if (!(requiredParam in params)) {
        missing.push(requiredParam);
      }
    }

    // Check for unexpected parameters
    const allowedParams = Object.keys(properties);
    for (const providedParam of Object.keys(params)) {
      if (!allowedParams.includes(providedParam)) {
        unexpected.push(providedParam);
      }
    }

    // Check for type mismatches
    for (const [paramName, paramValue] of Object.entries(params)) {
      const paramSchema = properties[paramName];
      if (!paramSchema) continue; // Already flagged as unexpected

      const expectedType = paramSchema.type;
      const actualType = this.getType(paramValue);

      if (!this.typesMatch(actualType, expectedType, paramValue)) {
        typeMismatch.push({
          param: paramName,
          expected: this.formatExpectedType(paramSchema),
          got: actualType,
        });
      }
    }

    // Build error messages
    if (missing.length > 0) {
      errors.push(`Missing required parameters: ${missing.join(', ')}`);
    }

    if (unexpected.length > 0) {
      errors.push(`Unexpected parameters: ${unexpected.join(', ')}`);
    }

    if (typeMismatch.length > 0) {
      for (const mismatch of typeMismatch) {
        errors.push(
          `Type mismatch for "${mismatch.param}": ` +
          `expected ${mismatch.expected}, got ${mismatch.got}`
        );
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
      missing: missing.length > 0 ? missing : undefined,
      unexpected: unexpected.length > 0 ? unexpected : undefined,
      typeMismatch: typeMismatch.length > 0 ? typeMismatch : undefined,
    };
  }

  /**
   * Generate a human-readable error message
   */
  formatError(toolName: string, params: any, schema: ToolSchema, result: ValidationResult): string {
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
        const typeInfo = propSchema ? this.formatExpectedType(propSchema) : 'any';
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
        const typeInfo = this.formatExpectedType(propSchema);
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

  /**
   * Get JavaScript type of a value
   */
  private getType(value: any): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  }

  /**
   * Check if types match (handles JSON Schema types)
   */
  private typesMatch(actualType: string, expectedType: string | string[], value: any): boolean {
    // Handle array of types
    if (Array.isArray(expectedType)) {
      return expectedType.some(t => this.typesMatch(actualType, t, value));
    }

    // Type aliases
    if (expectedType === 'integer' && actualType === 'number') {
      return Number.isInteger(value);
    }

    return actualType === expectedType;
  }

  /**
   * Format expected type for human readability
   */
  private formatExpectedType(schema: any): string {
    if (!schema) return 'any';

    const type = schema.type;

    if (Array.isArray(type)) {
      return type.join(' | ');
    }

    if (type === 'array') {
      const items = schema.items;
      if (items) {
        return `array<${this.formatExpectedType(items)}>`;
      }
      return 'array';
    }

    if (type === 'object') {
      return 'object';
    }

    return type || 'any';
  }
}
