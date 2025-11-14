/**
 * AJV Error Formatter (US13: FR-12)
 *
 * Transforms verbose AJV errors into user-friendly, actionable error messages.
 *
 * **WHY User-Friendly Errors?**
 * - Developers need actionable guidance, not raw validation output
 * - Common mistakes (e.g., number→string) should have instant fixes
 * - Self-documenting errors reduce support burden
 *
 * **Design Principles:**
 * - Include field name, expected type, actual value
 * - Provide executable "Try this..." suggestions
 * - Maintain backwards compatibility with raw AJV errors
 * - Handle common patterns: type coercion, enum, pattern, required
 */

import type { ErrorObject } from 'ajv';

export interface FormattedError {
  /** User-friendly error message with all details */
  userFriendly: string;
  /** Actionable suggestions for fixing the error */
  suggestions: string[];
  /** Raw AJV errors for backwards compatibility */
  rawErrors: ErrorObject[];
}

/**
 * AJV Error Formatter
 *
 * Converts AJV validation errors into user-friendly messages with suggestions.
 */
export class AjvErrorFormatter {
  /**
   * Format AJV errors into user-friendly messages with actionable suggestions
   *
   * T134: Parse AJV errors - Extract field name, expected type, actual value
   * T135: Generate suggestions - Provide actionable "Try this..." guidance
   * T136: Backwards compatibility - Include raw AJV errors in response
   *
   * @param ajvErrors - Array of AJV error objects
   * @param schema - JSON schema being validated against
   * @param params - Actual parameters provided by user
   * @returns Formatted error with user-friendly message, suggestions, and raw errors
   */
  format(ajvErrors: ErrorObject[], schema: any, params: any): FormattedError {
    const lines: string[] = [];
    const suggestions: string[] = [];

    // Group errors by type for better organization
    const errorsByType: Map<string, ErrorObject[]> = new Map();
    for (const error of ajvErrors) {
      const errors = errorsByType.get(error.keyword) || [];
      errors.push(error);
      errorsByType.set(error.keyword, errors);
    }

    // T134: Process each error type
    for (const [keyword, errors] of errorsByType) {
      switch (keyword) {
        case 'required':
          this.formatRequiredErrors(errors, schema, lines, suggestions);
          break;
        case 'type':
          this.formatTypeErrors(errors, schema, params, lines, suggestions);
          break;
        case 'enum':
          this.formatEnumErrors(errors, schema, lines, suggestions);
          break;
        case 'pattern':
          this.formatPatternErrors(errors, schema, lines, suggestions);
          break;
        case 'additionalProperties':
          this.formatAdditionalPropsErrors(errors, lines, suggestions);
          break;
        default:
          // Generic error handling
          for (const error of errors) {
            lines.push(`  - ${error.message || 'Validation error'}`);
          }
      }
    }

    // T136: Return formatted error with backwards compatibility
    return {
      userFriendly: lines.join('\n'),
      suggestions,
      rawErrors: ajvErrors, // Backwards compatibility
    };
  }

  /**
   * T134: Format "required" keyword errors
   *
   * Missing required parameters - suggest adding them with type info
   */
  private formatRequiredErrors(
    errors: ErrorObject[],
    schema: any,
    lines: string[],
    suggestions: string[]
  ): void {
    for (const error of errors) {
      const paramName = error.params.missingProperty;
      const paramSchema = schema.properties?.[paramName];
      const typeInfo = paramSchema?.type || 'unknown';
      const desc = paramSchema?.description ? ` (${paramSchema.description})` : '';

      lines.push(`  - Missing required parameter: ${paramName}${desc}`);

      // T135: Generate actionable suggestion
      suggestions.push(
        `Add required parameter: ${paramName}: ${typeInfo} - Example: { "${paramName}": ${this.getExampleValue(typeInfo)} }`
      );
    }
  }

  /**
   * T134: Format "type" keyword errors
   *
   * Type mismatches - suggest type coercion strategies
   */
  private formatTypeErrors(
    errors: ErrorObject[],
    schema: any,
    params: any,
    lines: string[],
    suggestions: string[]
  ): void {
    for (const error of errors) {
      const paramPath = error.instancePath.replace(/^\//, '').replace(/\//g, '.');
      const paramName = paramPath || 'root';
      const expectedType = error.params.type;
      const actualType = typeof error.data;
      const actualValue = error.data;

      const paramSchema = this.getNestedSchema(schema, paramPath);
      const desc = paramSchema?.description ? ` (${paramSchema.description})` : '';

      lines.push(`  - Type mismatch for "${paramName}"${desc}`);
      lines.push(`    Expected: ${expectedType}`);
      lines.push(`    Got: ${actualType} (value: ${JSON.stringify(actualValue)})`);

      // T135: Generate smart type coercion suggestions
      suggestions.push(this.generateTypeCoercionSuggestion(paramName, expectedType, actualType, actualValue));
    }
  }

  /**
   * T135: Generate smart type coercion suggestions
   *
   * Detect common patterns and provide executable fixes
   */
  private generateTypeCoercionSuggestion(
    paramName: string,
    expectedType: string,
    actualType: string,
    actualValue: any
  ): string {
    // String→Number: Remove quotes
    if (expectedType === 'number' && actualType === 'string') {
      return `Try: Remove quotes from "${paramName}" - Change "${actualValue}" to ${actualValue}`;
    }

    // Number→String: Add quotes
    if (expectedType === 'string' && actualType === 'number') {
      return `Try: Wrap in quotes - Change { "${paramName}": ${actualValue} } to { "${paramName}": "${actualValue}" }`;
    }

    // Single value→Array: Wrap in brackets
    if (expectedType === 'array' && actualType !== 'array') {
      return `Try: Wrap in array brackets - Change { "${paramName}": ${JSON.stringify(actualValue)} } to { "${paramName}": [${JSON.stringify(actualValue)}] }`;
    }

    // Array→String: Take first element
    if (expectedType === 'string' && actualType === 'object' && Array.isArray(actualValue)) {
      const firstValue = actualValue[0];
      return `Try: Use first element - Change { "${paramName}": ${JSON.stringify(actualValue)} } to { "${paramName}": ${JSON.stringify(firstValue)} }`;
    }

    // Boolean→String: Stringify
    if (expectedType === 'string' && actualType === 'boolean') {
      return `Try: Wrap in quotes - Change { "${paramName}": ${actualValue} } to { "${paramName}": "${actualValue}" }`;
    }

    // Generic fallback
    return `Try: Change "${paramName}" to ${expectedType} type`;
  }

  /**
   * T134: Format "enum" keyword errors
   *
   * Invalid enum values - show allowed values and suggest closest match
   */
  private formatEnumErrors(
    errors: ErrorObject[],
    schema: any,
    lines: string[],
    suggestions: string[]
  ): void {
    for (const error of errors) {
      const paramPath = error.instancePath.replace(/^\//, '').replace(/\//g, '.');
      const paramName = paramPath || 'root';
      const allowedValues = error.params.allowedValues;
      const actualValue = error.data;

      lines.push(`  - Invalid value for "${paramName}": ${JSON.stringify(actualValue)}`);
      lines.push(`    Allowed values: ${JSON.stringify(allowedValues)}`);

      // T135: Suggest choosing from allowed values
      suggestions.push(
        `Choose one of: ${allowedValues.map((v: any) => JSON.stringify(v)).join(', ')} for "${paramName}"`
      );
    }
  }

  /**
   * T134: Format "pattern" keyword errors
   *
   * Regex pattern mismatches - show pattern and provide example
   */
  private formatPatternErrors(
    errors: ErrorObject[],
    schema: any,
    lines: string[],
    suggestions: string[]
  ): void {
    for (const error of errors) {
      const paramPath = error.instancePath.replace(/^\//, '').replace(/\//g, '.');
      const paramName = paramPath || 'root';
      const pattern = error.params.pattern;
      const actualValue = error.data;

      lines.push(`  - Pattern mismatch for "${paramName}": ${JSON.stringify(actualValue)}`);
      lines.push(`    Expected pattern: ${pattern}`);

      // T135: Provide pattern-specific suggestions
      if (pattern.includes('@')) {
        suggestions.push(`Try: Ensure "${paramName}" includes an @ symbol (e.g., "user@example.com")`);
      } else if (pattern.includes('^http')) {
        suggestions.push(`Try: Ensure "${paramName}" starts with http:// or https://`);
      } else {
        suggestions.push(`Try: Ensure "${paramName}" matches the pattern: ${pattern}`);
      }
    }
  }

  /**
   * T134: Format "additionalProperties" keyword errors
   *
   * Unexpected parameters - suggest removing them
   */
  private formatAdditionalPropsErrors(errors: ErrorObject[], lines: string[], suggestions: string[]): void {
    for (const error of errors) {
      const additionalProp = error.params.additionalProperty;

      lines.push(`  - Unexpected parameter: ${additionalProp}`);

      // T135: Suggest removing unexpected param
      suggestions.push(`Remove unexpected parameter: "${additionalProp}"`);
    }
  }

  /**
   * Helper: Get nested schema property
   */
  private getNestedSchema(schema: any, path: string): any {
    if (!path) return schema;

    const parts = path.split('.');
    let current = schema;

    for (const part of parts) {
      current = current?.properties?.[part];
      if (!current) break;
    }

    return current;
  }

  /**
   * Helper: Get example value for a type
   */
  private getExampleValue(type: string): string {
    switch (type) {
      case 'string':
        return '"example"';
      case 'number':
        return '42';
      case 'boolean':
        return 'true';
      case 'array':
        return '[]';
      case 'object':
        return '{}';
      default:
        return 'null';
    }
  }
}
