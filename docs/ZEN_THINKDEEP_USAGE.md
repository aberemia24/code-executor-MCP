# Zen ThinkDeep Tool Usage Guide

**Tool:** `mcp__zen__thinkdeep`
**Purpose:** Extended reasoning, edge case analysis, alternative perspectives using Gemini/OpenAI models
**Status:** ✅ WORKING (as of 2025-01-09)

## Required Parameters

```typescript
{
  step: string,              // The question/task description
  step_number: number,       // Current step number (1-based)
  total_steps: number,       // Total number of steps in analysis
  next_step_required: boolean, // Whether more steps are needed
  findings: string,          // Accumulated findings from previous steps (empty string for first step)
  model: string              // Model to use (see Available Models below)
}
```

## Available Models (Jan 2025)

**Recommended for thinkdeep:**
- `gemini-2.5-pro` - Best for extended reasoning ✅ RECOMMENDED
- `gemini-2.5-flash` - Faster, less thorough
- `o3-pro` - OpenAI O3 (requires OPENAI_API_KEY)
- `o3-mini` - Smaller O3 model

**Aliases:**
- `pro`, `gemini pro`, `gemini-pro` → `gemini-2.5-pro`
- `flash`, `flash2.5` → `gemini-2.5-flash`
- `codex`, `gpt-5-codex` → GPT-5 Codex
- `o3`, `o3pro` → O3 Pro
- Many more (see error message for full list)

## Multi-Step Flow

ThinkDeep works in a multi-step iterative process:

1. **Step 1:** Initial analysis (confidence: low)
   - Returns `continuation_id`
   - Status: `pause_for_thinkdeep`

2. **Step 2:** Deeper investigation
   - Use same `continuation_id`
   - Add findings from step 1
   - Confidence increases

3. **Step 3:** Final synthesis
   - Combine all findings
   - Provide comprehensive analysis
   - Status: `complete`

## Example Usage

### Step 1: Initial Analysis

```typescript
const result1 = await callMCPTool('mcp__zen__thinkdeep', {
  step: `Architecture Analysis: How to extend code-executor-mcp for multi-transport support?

  Current State:
  - Only stdio transport
  - No authentication

  Target:
  - stdio, SSE, Streamable HTTP
  - OAuth 2.1 with PKCE
  - Token management`,
  step_number: 1,
  total_steps: 3,
  next_step_required: true,
  findings: '',
  model: 'gemini-2.5-pro'
});

// Result includes continuation_id
const continuationId = JSON.parse(result1).continuation_id;
```

### Step 2: Deeper Investigation

```typescript
const result2 = await callMCPTool('mcp__zen__thinkdeep', {
  step: 'Continue architectural analysis. Focus on OAuth 2.1 implementation details and token management patterns.',
  step_number: 2,
  total_steps: 3,
  next_step_required: true,
  findings: JSON.parse(result1).findings || '',
  model: 'gemini-2.5-pro'
});
```

### Step 3: Final Synthesis

```typescript
const result3 = await callMCPTool('mcp__zen__thinkdeep', {
  step: 'Synthesize findings and provide implementation recommendations with risk assessment.',
  step_number: 3,
  total_steps: 3,
  next_step_required: false,
  findings: JSON.parse(result2).findings || '',
  model: 'gemini-2.5-pro'
});

// Final result with complete analysis
console.log(JSON.parse(result3).content);
```

## Response Format

```typescript
{
  status: 'pause_for_thinkdeep' | 'complete',
  step_number: number,
  total_steps: number,
  next_step_required: boolean,
  thinkdeep_status: {
    files_checked: number,
    relevant_files: number,
    relevant_context: number,
    issues_found: number,
    images_collected: number,
    current_confidence: 'low' | 'medium' | 'high'
  },
  continuation_id: string,  // Use for subsequent steps
  thinkdeep_required: boolean,
  required_actions: string[],
  next_steps: string,
  thinking_status: {
    current_step: number,
    total_steps: number,
    files_checked: number,
    relevant_files: number,
    thinking_confidence: 'low' | 'medium' | 'high',
    analysis_focus: string[]
  },
  content?: string,  // Final analysis (step 3)
  findings?: string, // Accumulated findings
  metadata: {
    tool_name: 'thinkdeep',
    model_used: string,
    provider_used: 'google' | 'openai' | 'openrouter'
  }
}
```

## Common Errors

### "Model '...' is not available"
**Fix:** Use one of the available models listed above. Recommended: `gemini-2.5-pro`

### "Input validation error: '...' is a required property"
**Fix:** Ensure all 6 required parameters are provided:
- `step` (string)
- `step_number` (number)
- `total_steps` (number)
- `next_step_required` (boolean)
- `findings` (string, empty for first step)
- `model` (string, valid model name)

### "Additional properties are not allowed"
**Fix:** Do NOT include `question` parameter. Use `step` instead.

### "[] is not of type 'string'"
**Fix:** `findings` must be a string, not an array. Use empty string `''` for first step.

## Environment Variables

Required in `.mcp.json` zen configuration:

```json
{
  "zen": {
    "command": "...",
    "env": {
      "GEMINI_API_KEY": "your-key-here",      // For gemini models
      "OPENAI_API_KEY": "your-key-here",      // For o3/GPT models
      "OPENROUTER_API_KEY": "your-key-here"   // For OpenRouter models
    }
  }
}
```

## Best Practices

1. **Use 3 steps minimum** for complex analysis
2. **Start with gemini-2.5-pro** (best reasoning)
3. **Accumulate findings** across steps
4. **Be specific** in step descriptions
5. **Track continuation_id** for multi-step flows
6. **Parse JSON responses** before using
7. **Check confidence level** to decide if more steps needed

## Integration Example

See `/home/alexandrueremia/projects/code-executor-mcp/docs/MULTI_TRANSPORT_PLAN.md` for a complete implementation plan created using thinkdeep analysis.

---

**Last Updated:** 2025-01-09
**Status:** Production-ready
**Tested:** ✅ Working with gemini-2.5-pro
