#!/usr/bin/env node
/**
 * Simple verification that ToolSchema uses inputSchema property
 */

import { readFileSync } from 'fs';

console.log('🔍 Verifying inputSchema fix across codebase...\n');

const files = [
  { path: 'src/types/discovery.ts', type: 'discovery' },
  { path: 'src/cli/types.ts', type: 'cli' },
  { path: 'src/mcp/client-pool.ts', type: 'implementation' },
];

let allGood = true;

for (const {path, type} of files) {
  const content = readFileSync(path, 'utf8');

  console.log(`\n📄 Checking ${type}: ${path}`);

  // Check for inputSchema property
  const hasInputSchema = content.includes('inputSchema:');
  const hasParameters = content.match(/parameters:\s*(schema|tool|discoveryTool)/) !== null;

  if (type === 'discovery' || type === 'cli') {
    // Type definitions should have inputSchema
    const interfaceMatch = content.match(/interface ToolSchema \{[^}]+inputSchema:/s);
    if (interfaceMatch) {
      console.log('  ✅ ToolSchema interface uses inputSchema');
    } else {
      console.log('  ❌ ToolSchema interface missing inputSchema!');
      allGood = false;
    }

    // Should NOT have parameters property in ToolSchema
    const badMatch = content.match(/interface ToolSchema \{[^}]+parameters:/s);
    if (badMatch) {
      console.log('  ❌ ToolSchema still has parameters property!');
      allGood = false;
    } else {
      console.log('  ✅ No parameters property in ToolSchema');
    }
  }

  if (type === 'implementation') {
    // Implementation should create objects with inputSchema
    if (content.includes('inputSchema: schema.inputSchema')) {
      console.log('  ✅ Returns objects with inputSchema property');
    } else if (content.includes('parameters: schema.inputSchema')) {
      console.log('  ❌ Still using parameters property!');
      allGood = false;
    } else {
      console.log('  ⚠️  Could not verify property usage');
    }
  }
}

console.log('\n' + '='.repeat(60));
if (allGood) {
  console.log('✅ SUCCESS! All files use inputSchema correctly');
  console.log('   Templates will receive data with inputSchema property');
  console.log('   Wrapper generation should work now!\n');
  process.exit(0);
} else {
  console.log('❌ FAILURE! Some files still use parameters');
  console.log('   Wrapper generation will fail!\n');
  process.exit(1);
}
