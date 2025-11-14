# Creating MCP Tool Wrappers

**Learn how to create type-safe TypeScript wrappers for MCP tools in your project.**

## ⚠️ Why We Don't Ship Wrappers

**MCP servers update independently.** Their APIs can change at any time without warning.

**Real example:**
- Zen MCP changed from `cli_name` → `model`
- Changed from `query` → `step`
- Changed from `findings: []` → `findings: ''`
- **If we shipped wrappers, they'd be broken** ❌

**The solution:** You create and maintain wrappers that match YOUR installed MCP server versions.

---

## Quick Start (5 Minutes)

### 1. Copy Utilities Template (REQUIRED)

```bash
# First, copy the shared utilities
cp docs/examples/utils-template.ts src/lib/mcp/utils.ts
```

**Why?** The utilities provide:
- ✅ Error handling with context
- ✅ Type-safe globalThis interface
- ✅ DRY-compliant JSON parsing
- ✅ Consistent error messages

### 2. Copy Wrapper Template

Choose a template from this directory:
- `zen-wrapper-template.ts` - AI analysis tools
- `filesystem-wrapper-template.ts` - File operations

```bash
# Copy template to your project
cp docs/examples/zen-wrapper-template.ts src/lib/mcp/zen.ts
```

### 3. Adapt to Your Environment

```typescript
// src/lib/mcp/zen.ts
// You own this file now - update params when zen updates

import { callMCPToolSafe, parseMCPResult } from './utils';

export async function zenThinkDeep(question: string) {
  const result = await callMCPToolSafe(
    'mcp__zen__thinkdeep',
    {
      // Update these params to match YOUR zen version
      step: question,
      step_number: 1,
      total_steps: 1,
      next_step_required: false,
      findings: '',
      model: 'gemini-2.5-pro'
    },
    'zen thinkdeep'  // Context for error messages
  );

  return parseMCPResult(result);
}
```

### 3. Use It

```typescript
import { zenThinkDeep } from './lib/mcp/zen';

const analysis = await zenThinkDeep('How to optimize this?');
console.log(analysis.content);
```

---

## Creating Your Own Wrappers

### Pattern (Improved with Error Handling)

**Every MCP tool wrapper follows this pattern:**

```typescript
import { callMCPToolSafe, parseMCPResult } from './utils';

export async function toolName(
  param1: string,
  param2?: number
): Promise<ReturnType> {
  const result = await callMCPToolSafe(
    'mcp__server__tool',
    {
      param1,
      ...(param2 && { param2 })
    },
    'server tool'  // Context for error messages
  );

  return parseMCPResult<ReturnType>(result);
}
```

**Benefits:**
- ✅ **Error handling** - Clear error messages with context
- ✅ **Type safety** - No `(globalThis as any)`
- ✅ **DRY** - Shared JSON parsing logic
- ✅ **Maintainability** - Update utilities, all wrappers benefit

### Example: Linear MCP

```typescript
// src/lib/mcp/linear.ts
import { callMCPToolSafe, parseMCPResult } from './utils';

/**
 * Create Linear issue
 */
export async function linearCreateIssue(
  title: string,
  description: string,
  teamId?: string
): Promise<{
  id: string;
  url: string;
  identifier: string;
}> {
  const result = await callMCPToolSafe(
    'mcp__linear__create_issue',
    {
      title,
      description,
      ...(teamId && { teamId })
    },
    'linear create_issue'
  );

  return parseMCPResult(result);
}

/**
 * List Linear issues
 */
export async function linearListIssues(filters?: {
  teamId?: string;
  status?: string;
}): Promise<Array<{
  id: string;
  title: string;
  url: string;
}>> {
  const result = await callMCPToolSafe(
    'mcp__linear__list_issues',
    { ...filters },
    'linear list_issues'
  );

  return parseMCPResult(result);
}
```

### Example: GitHub MCP

```typescript
// src/lib/mcp/github.ts

/**
 * Create GitHub issue
 */
export async function githubCreateIssue(
  owner: string,
  repo: string,
  title: string,
  body: string
): Promise<{
  number: number;
  url: string;
}> {
  const result = await callMCPToolSafe(
    'mcp__github__create_issue',
    { owner, repo, title, body },
    'github create_issue'
  );

  return parseMCPResult(result);
}

/**
 * Create pull request
 */
export async function githubCreatePR(
  owner: string,
  repo: string,
  title: string,
  head: string,
  base: string
): Promise<{
  number: number;
  url: string;
}> {
  const result = await callMCPToolSafe(
    'mcp__github__create_pull_request',
    { owner, repo, title, head, base },
    'github create_pull_request'
  );

  return parseMCPResult(result);
}
```

---

## Best Practices

### 1. Type Everything

```typescript
// ✅ GOOD: Full types
export async function createTask(
  title: string,
  priority: 'P0' | 'P1' | 'P2' | 'P3' | 'P4'
): Promise<{ id: string; url: string }> {
  // ...
}

// ❌ BAD: No types
export async function createTask(title, priority) {
  // ...
}
```

### 2. Use Shared Utilities

```typescript
import { callMCPToolSafe, parseMCPResult } from './utils';

// Let utilities handle error wrapping and JSON parsing
const result = await callMCPToolSafe('mcp__tool__name', params, 'tool description');
return parseMCPResult<YourType>(result);
```

**Benefits:**
- Automatic error handling with context
- Type-safe (no `globalThis as any`)
- DRY - all parsing logic in one place

### 3. Optional Parameters

```typescript
import { callMCPToolSafe, parseMCPResult } from './utils';

export async function createTask(
  title: string,
  options?: {
    priority?: 'P0' | 'P1' | 'P2';
    tags?: string[];
  }
): Promise<{ id: string }> {
  const result = await callMCPToolSafe(
    'mcp__tasks__create',
    {
      title,
      ...(options?.priority && { priority: options.priority }),
      ...(options?.tags && { tags: options.tags })
    },
    'tasks create'
  );

  return parseMCPResult(result);
}
```

### 4. Add JSDoc Comments

```typescript
/**
 * Create a task
 *
 * @param title - Task title
 * @param priority - Priority level (P0-P4)
 * @returns Created task with ID and URL
 *
 * @example
 * const task = await createTask('Fix bug', 'P0');
 * console.log(`Created: ${task.url}`);
 */
export async function createTask(
  title: string,
  priority: 'P0' | 'P1' | 'P2' | 'P3' | 'P4'
): Promise<{ id: string; url: string }> {
  // ...
}
```

### 5. Error Handling (Automatic with Utilities)

```typescript
import { callMCPToolSafe, parseMCPResult } from './utils';

// callMCPToolSafe handles errors automatically with context
export async function createIssue(title: string): Promise<{ id: string }> {
  const result = await callMCPToolSafe(
    'mcp__linear__create_issue',
    { title },
    'linear create_issue'  // This context appears in error messages
  );

  return parseMCPResult(result);
}

// If it fails, users get: "Failed to call linear create_issue: [actual error]"
// No manual try-catch needed unless you want custom handling
```

**Benefits:**
- Automatic error wrapping with context
- Consistent error format across all wrappers
- Less boilerplate code

---

## Discovering Tool Parameters

### Method 1: Check MCP Server Docs

Most MCP servers document their tools:
- **Zen:** https://github.com/BeehiveInnovations/zen-mcp-server
- **Linear:** https://linear.app/docs/mcp
- **GitHub:** https://github.com/modelcontextprotocol/servers

### Method 2: Inspect Tool Schema

```typescript
// Use code-executor to inspect available tools
const tools = await callMCPTool('mcp__code-executor__run-typescript-code', {
  code: `
    // This runs in sandbox with access to all MCP tools
    console.log('Available tools:', Object.keys(globalThis));
  `,
  allowedTools: []
});
// Legacy alias: 'mcp__code-executor__executeTypescript'
```

### Method 3: Trial and Error

```typescript
// Try calling the tool and see what error you get
try {
  await callMCPTool('mcp__linear__create_issue', {
    // Add params one by one until it works
    title: 'Test'
  });
} catch (error) {
  console.log(error); // Error will tell you missing params
}
```

---

## Organizing Your Wrappers

### Recommended Structure

```
your-project/
├── src/
│   └── lib/
│       └── mcp/
│           ├── utils.ts         # Shared utilities (REQUIRED)
│           ├── zen.ts           # Zen AI tools
│           ├── filesystem.ts    # File operations
│           ├── linear.ts        # Linear integration
│           ├── github.ts        # GitHub integration
│           └── index.ts         # Export all
└── package.json
```

### Index File

```typescript
// src/lib/mcp/index.ts

// Export utilities
export * from './utils';

// Export all wrappers
export * from './zen';
export * from './filesystem';
export * from './linear';
export * from './github';
```

### Usage

```typescript
import {
  zenThinkDeep,
  readFile,
  linearCreateIssue,
  githubCreatePR
} from '@/lib/mcp';

// All tools available with TypeScript autocomplete
const analysis = await zenThinkDeep('question');
const code = await readFile('/src/index.ts');
const issue = await linearCreateIssue('Bug', 'Description');
const pr = await githubCreatePR('owner', 'repo', 'Title', 'feature', 'main');
```

---

## When MCP Servers Update

**What happens:** MCP server releases new version with different parameters

**Your action:**
1. Update your wrapper file to match new params
2. Test it
3. Done! (No waiting for package maintainers)

**Example:**

```typescript
// zen-mcp-server v2.0.0 changes 'step' to 'question'

// Update your wrapper:
import { callMCPToolSafe, parseMCPResult } from './utils';

export async function zenThinkDeep(question: string) {
  const result = await callMCPToolSafe(
    'mcp__zen__thinkdeep',
    {
      question,  // Changed from 'step'
      // ... other params
    },
    'zen thinkdeep'
  );
  return parseMCPResult(result);
}
```

---

## Testing Your Wrappers

```typescript
// src/lib/mcp/__tests__/zen.test.ts
import { describe, it, expect, vi } from 'vitest';
import { zenThinkDeep } from '../zen';

describe('Zen MCP Wrappers', () => {
  it('should call thinkdeep with correct params', async () => {
    const mockCallMCPTool = vi.fn().mockResolvedValue({
      status: 'complete',
      content: 'Analysis result'
    });
    (globalThis as any).callMCPTool = mockCallMCPTool;

    const result = await zenThinkDeep('Test question');

    expect(result.content).toBe('Analysis result');
    expect(mockCallMCPTool).toHaveBeenCalledWith(
      'mcp__zen__thinkdeep',
      expect.objectContaining({
        step: 'Test question',
        model: 'gemini-2.5-pro'
      })
    );
  });
});
```

---

## Complete Example

**src/lib/mcp/zen.ts:**
```typescript
import { callMCPToolSafe, parseMCPResult } from './utils';

export type ZenModel = 'gemini-2.5-pro' | 'gemini-2.5-flash' | 'o3-pro';

export async function zenThinkDeep(
  question: string,
  model: ZenModel = 'gemini-2.5-pro'
): Promise<{ content: string }> {
  const result = await callMCPToolSafe(
    'mcp__zen__thinkdeep',
    {
      step: question,
      step_number: 1,
      total_steps: 1,
      next_step_required: false,
      findings: '',
      model
    },
    'zen thinkdeep'
  );

  return parseMCPResult(result);
}
```

**Usage:**
```typescript
import { zenThinkDeep } from '@/lib/mcp/zen';

const analysis = await zenThinkDeep('How to optimize database queries?');
console.log(analysis.content);
```

---

## FAQ

**Q: Why not ship wrappers in the package?**
A: MCP servers update independently. Shipped wrappers would break when servers update, causing frustration.

**Q: Can I share my wrappers?**
A: Yes! Share them as gists, repos, or contribute examples to this project.

**Q: What if I don't want to maintain wrappers?**
A: Call `callMCPTool()` directly. Wrappers are optional convenience.

**Q: Can I use these in production?**
A: Yes, but YOU maintain them when MCP servers update.

**Q: Do wrappers work in client components?**
A: No, only in code-executor sandbox (server-side).

---

## Getting Help

- **MCP Servers:** Check their individual documentation
- **Code Executor:** See main README.md
- **Examples:** Check other templates in `docs/examples/`
- **Issues:** Open GitHub issue if you find problems

---

**Remember:** You own your wrappers. Update them when MCP servers update. This gives you control and prevents breakage.
