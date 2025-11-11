# MCP Tool Discovery - Complete Workflow Example

This example demonstrates the complete in-sandbox MCP tool discovery workflow: **discover → inspect → execute** in a single round-trip.

## Overview

The discovery feature enables AI agents to explore available MCP tools without context switching. Three functions are injected into the Deno sandbox:

1. **`discoverMCPTools(options?)`** - Discover all available tools (with optional search)
2. **`getToolSchema(toolName)`** - Get detailed schema for a specific tool
3. **`searchTools(query, limit?)`** - Search tools by keywords with result limiting

## Complete Workflow Example

```typescript
// PHASE 1: Discovery - Find tools matching criteria
// Search for file-related tools, limit to 5 results
const fileTools = await searchTools('file read write', 5);

console.log(`Found ${fileTools.length} file-related tools`);
fileTools.forEach(tool => {
  console.log(`- ${tool.name}: ${tool.description}`);
});

// PHASE 2: Inspection - Get detailed schema for specific tool
// Get full schema including parameter definitions
const readFileSchema = await getToolSchema('mcp__filesystem__read_file');

if (readFileSchema) {
  console.log('Tool Name:', readFileSchema.name);
  console.log('Description:', readFileSchema.description);
  console.log('Required Parameters:', readFileSchema.parameters.required);
  console.log('Parameter Schema:', JSON.stringify(readFileSchema.parameters, null, 2));
}

// PHASE 3: Execution - Use callMCPTool to execute discovered tool
// Now that we know the schema, we can call the tool with correct parameters
const fileContent = await callMCPTool('mcp__filesystem__read_file', {
  path: '/tmp/example.txt'
});

console.log('File content:', fileContent);
```

## Output Example

```
Found 2 file-related tools
- mcp__filesystem__read_file: Read a file from the filesystem
- mcp__filesystem__write_file: Write content to a file

Tool Name: mcp__filesystem__read_file
Description: Read a file from the filesystem
Required Parameters: ["path"]
Parameter Schema: {
  "type": "object",
  "required": ["path"],
  "properties": {
    "path": {
      "type": "string",
      "description": "File path to read"
    }
  }
}

File content: Hello from the file!
```

## Use Case: Self-Service Tool Discovery

This workflow enables AI agents to autonomously:

1. **Explore capabilities** - Discover what tools are available
2. **Understand requirements** - Inspect parameter schemas before calling
3. **Execute confidently** - Call tools with validated parameters

All three phases happen **in a single sandbox execution** with **no context switching**.

## Performance Characteristics

- **First discovery call**: 50-100ms (populates cache)
- **Subsequent calls**: <5ms (from cache)
- **Timeout protection**: 500ms max (prevents hanging)
- **Cache TTL**: 24 hours (disk-persisted, survives restarts)

## Key Benefits

✅ **Progressive Disclosure**: Discovery functions not exposed as top-level MCP tools (preserves ~1.6k token budget)
✅ **Single Round-Trip**: Complete workflow in one sandbox execution
✅ **Variables Persist**: No context loss between discovery steps
✅ **Type-Safe**: Full TypeScript schema information available
✅ **Cached**: Subsequent discoveries are sub-5ms fast
✅ **Secure**: Bearer token authentication, rate limiting, audit logging

## Alternative: Discover All Tools First

```typescript
// Alternative workflow: Get all tools, then filter client-side
const allTools = await discoverMCPTools();

console.log(`Total tools available: ${allTools.length}`);

// Filter by keyword locally (no additional HTTP request)
const fileTools = allTools.filter(tool =>
  tool.name.includes('file') ||
  tool.description.toLowerCase().includes('file')
);

console.log(`File-related tools: ${fileTools.length}`);

// Get specific schema
const readTool = fileTools.find(t => t.name.includes('read_file'));
if (readTool) {
  const schema = await getToolSchema(readTool.name);
  console.log('Schema:', schema);
}
```

## Error Handling

```typescript
try {
  // Discovery with timeout protection (500ms max)
  const tools = await discoverMCPTools({ search: ['network'] });

  if (tools.length === 0) {
    console.log('No network tools found');
  } else {
    console.log(`Found ${tools.length} network tools`);
  }
} catch (error) {
  // Handles 401 (auth failure), 429 (rate limit), timeout errors
  console.error('Discovery failed:', error.message);

  if (error.message.includes('401')) {
    console.log('Authentication required');
  } else if (error.message.includes('429')) {
    console.log('Rate limit exceeded - wait and retry');
  } else if (error.message.includes('timeout')) {
    console.log('Discovery took too long (>500ms)');
  }
}
```

## Advanced: Conditional Tool Execution

```typescript
// Discover tools, inspect schema, validate before execution
const tools = await discoverMCPTools();

// Find tool matching criteria
const networkTool = tools.find(t =>
  t.name.includes('fetch') &&
  t.description.includes('URL')
);

if (!networkTool) {
  console.log('No fetch tool available');
} else {
  // Get schema to validate we have required permissions
  const schema = await getToolSchema(networkTool.name);

  // Check if tool requires parameters we can provide
  const requiredParams = schema?.parameters?.required || [];
  const canExecute = requiredParams.every(param =>
    ['url', 'method', 'headers'].includes(param)
  );

  if (canExecute) {
    // Safe to execute - we know the schema
    const response = await callMCPTool(networkTool.name, {
      url: 'https://api.example.com/data',
      method: 'GET'
    });
    console.log('API response:', response);
  } else {
    console.log('Tool requires parameters we cannot provide');
    console.log('Required:', requiredParams);
  }
}
```

## Constitutional Compliance

This implementation follows the project's constitutional principles:

- **Principle 1 (Progressive Disclosure)**: Discovery functions injected into sandbox, not exposed as top-level MCP tools
- **Principle 2 (Security)**: Bearer token authentication, rate limiting (30 req/60s), audit logging
- **Principle 8 (Performance)**: 500ms timeout, schema caching (50-100ms → <5ms), parallel queries
- **Principle 9 (Documentation)**: Full JSDoc with `@param`, `@returns`, `@throws`, `@example` tags

## Next Steps

For implementation details, see:
- **Specification**: `specs/001-in-sandbox-discovery/spec.md`
- **Implementation Plan**: `specs/001-in-sandbox-discovery/plan.md`
- **Test Suite**: `tests/sandbox-executor-discovery.test.ts`, `tests/discovery-integration.test.ts`
