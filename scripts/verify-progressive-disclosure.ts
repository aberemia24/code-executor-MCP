/**
 * Verify Progressive Disclosure Preservation (Phase 8 - Task 8.1)
 *
 * Validates that:
 * 1. Top-level MCP tools remain at 2-3 (no increase)
 * 2. Token usage stays ~1.6k tokens
 * 3. Discovery functions NOT exposed as top-level tools
 */

import { readFileSync } from 'fs';
import { join } from 'path';

// Tool schema extraction from index.ts
const indexContent = readFileSync(join(process.cwd(), 'src/index.ts'), 'utf-8');

// Count registered tools
const toolRegistrations = indexContent.match(/server\.registerTool\(/g) || [];
const toolCount = toolRegistrations.length;

console.log('=== PROGRESSIVE DISCLOSURE VERIFICATION ===\n');

// Task T118: Count top-level MCP tools
console.log('T118: Top-Level Tool Count');
console.log(`Found ${toolCount} tools registered\n`);

// Extract tool names
const executeTypescriptMatch = indexContent.match(/'executeTypescript'/);
const executePythonMatch = indexContent.match(/'executePython'/);
const healthMatch = indexContent.match(/'health'/);

const tools: string[] = [];
if (executeTypescriptMatch) tools.push('executeTypescript');
if (executePythonMatch) tools.push('executePython');
if (healthMatch) tools.push('health');

console.log('Registered Tools:');
tools.forEach((tool, i) => console.log(`  ${i + 1}. ${tool}`));
console.log();

// Task T119: Measure token usage (approximate)
// Rough estimate: ~4 characters per token for English text
function estimateTokens(text: string): number {
  // More accurate: count words and special characters
  const words = text.split(/\s+/).length;
  const specialChars = (text.match(/[{}[\]():;,]/g) || []).length;
  return Math.ceil((words + specialChars / 2) * 1.3); // Approximation
}

console.log('T119: Token Usage Estimation');

// Extract executeTypescript description
const executeTypescriptDescMatch = indexContent.match(
  /title: 'Execute TypeScript with MCP Access',\s*description: `([^`]+)`/s
);
const executeTypescriptDesc = executeTypescriptDescMatch ? executeTypescriptDescMatch[1] : '';

// Extract executePython description
const executePythonDescMatch = indexContent.match(
  /title: 'Execute Python with MCP Access',\s*description: `([^`]+)`/s
);
const executePythonDesc = executePythonDescMatch ? executePythonDescMatch[1] : '';

// Extract health description
const healthDescMatch = indexContent.match(
  /title: 'Server Health Check',\s*description: `([^`]+)`/s
);
const healthDesc = healthDescMatch ? healthDescMatch[1] : '';

const executeTypescriptTokens = estimateTokens(executeTypescriptDesc);
const executePythonTokens = estimateTokens(executePythonDesc);
const healthTokens = estimateTokens(healthDesc);
const totalTokens = executeTypescriptTokens + executePythonTokens + healthTokens;

console.log(`  executeTypescript: ~${executeTypescriptTokens} tokens`);
console.log(`  executePython: ~${executePythonTokens} tokens`);
console.log(`  health: ~${healthTokens} tokens`);
console.log(`  TOTAL: ~${totalTokens} tokens\n`);

// Task T120: Verify discovery functions NOT in top-level list
console.log('T120: Discovery Functions Check');

const discoveryFunctions = ['discoverMCPTools', 'getToolSchema', 'searchTools'];
const discoveryInTopLevel = discoveryFunctions.some(fn =>
  indexContent.includes(`registerTool('${fn}'`)
);

if (discoveryInTopLevel) {
  console.log('  ❌ FAIL: Discovery functions found in top-level tools!');
} else {
  console.log('  ✅ PASS: Discovery functions NOT in top-level tools');
  console.log('  Discovery functions are injected into sandbox only');
}
console.log();

// Task T121: Document measurements
console.log('=== SUMMARY ===\n');
console.log(`Tool Count: ${toolCount} (Target: 2-3) - ${toolCount >= 2 && toolCount <= 3 ? '✅ PASS' : '❌ FAIL'}`);
console.log(`Token Usage: ~${totalTokens} tokens (Target: ~1.6k) - ${totalTokens < 2000 ? '✅ PASS' : '⚠️  REVIEW'}`);
console.log(`Discovery Not Top-Level: ${!discoveryInTopLevel ? '✅ PASS' : '❌ FAIL'}`);
console.log();

// Overall verdict
const allPass = toolCount >= 2 && toolCount <= 3 && totalTokens < 2000 && !discoveryInTopLevel;
console.log(`Overall Verdict: ${allPass ? '✅ PROGRESSIVE DISCLOSURE PRESERVED' : '❌ PROGRESSIVE DISCLOSURE VIOLATED'}`);
console.log();

// Exit with appropriate code
process.exit(allPass ? 0 : 1);
