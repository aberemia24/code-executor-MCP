# Hybrid Sampling Architecture

**Goal:** Support both MCP SDK sampling (free) and direct Anthropic API (fallback) with automatic detection.

## Architecture Diagram

```
User Code (Sandbox)
    ↓
sampleLLM() call
    ↓
Sampling Bridge Server
    ↓
[Detection Logic]
    ↓
├─ Option A: MCP SDK Available? ────→ Use sampling/createMessage (FREE)
│                                      └─→ Claude Desktop handles auth
│
└─ Option B: MCP SDK Unavailable ───→ Use Anthropic SDK (REQUIRES API KEY)
                                       └─→ Direct API call, user pays per-token
```

## Implementation Plan

### 1. Update SamplingBridgeServer Constructor

```typescript
// src/sampling-bridge-server.ts

export class SamplingBridgeServer {
  private samplingMode: 'mcp' | 'direct' | null = null;

  constructor(
    private mcpServer: Server | any,
    config?: SamplingConfig,
    anthropicClient?: Anthropic
  ) {
    this.config = config || DEFAULT_CONFIG;

    // Try to detect MCP sampling capability
    this.samplingMode = this.detectSamplingMode();

    // Only require Anthropic client if MCP sampling unavailable
    if (this.samplingMode === 'direct') {
      if (anthropicClient) {
        this.anthropic = anthropicClient;
      } else {
        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
          console.warn(
            'MCP sampling unavailable and ANTHROPIC_API_KEY not set. ' +
            'Sampling will fail unless API key is provided.'
          );
        } else {
          this.anthropic = new Anthropic({ apiKey });
        }
      }
    }
  }

  /**
   * Detect which sampling mode to use
   *
   * @returns 'mcp' if MCP SDK sampling available, 'direct' for Anthropic API
   */
  private detectSamplingMode(): 'mcp' | 'direct' {
    // Check if mcpServer has request method and is connected
    if (this.mcpServer && typeof this.mcpServer.request === 'function') {
      // Try to check capabilities (may not be available in all MCP SDK versions)
      try {
        // If mcpServer exists and has request method, assume MCP sampling works
        // We'll verify on first actual sampling call
        console.log('[Sampling] MCP SDK detected, will attempt MCP sampling first');
        return 'mcp';
      } catch (error) {
        console.warn('[Sampling] MCP SDK detection failed, falling back to direct API');
        return 'direct';
      }
    }

    console.log('[Sampling] No MCP SDK detected, using direct Anthropic API');
    return 'direct';
  }
}
```

### 2. Add MCP Sampling Method

```typescript
// src/sampling-bridge-server.ts

/**
 * Call Claude via MCP SDK sampling/createMessage
 *
 * @returns LLMResponse or null if MCP sampling failed
 */
private async callViaMCPSampling(
  messages: LLMMessage[],
  model: string,
  maxTokens: number,
  systemPrompt?: string
): Promise<LLMResponse | null> {
  try {
    // Convert to MCP message format
    const mcpMessages = messages.map(msg => ({
      role: msg.role,
      content: {
        type: 'text',
        text: typeof msg.content === 'string'
          ? msg.content
          : msg.content.map(c => c.text).join('\n')
      }
    }));

    // Call MCP SDK's sampling/createMessage
    const response = await this.mcpServer.request({
      method: 'sampling/createMessage',
      params: {
        messages: mcpMessages,
        modelPreferences: {
          hints: [{ name: model }]
        },
        maxTokens,
        systemPrompt: systemPrompt || undefined,
        includeContext: 'none'
      }
    });

    // Convert response to our format
    return {
      content: Array.isArray(response.content)
        ? response.content
        : [{ type: 'text', text: response.content.text }],
      stopReason: response.stopReason,
      model: response.model,
      usage: {
        inputTokens: 0,  // MCP SDK may not provide token counts
        outputTokens: 0
      }
    };

  } catch (error) {
    console.error('[Sampling] MCP sampling failed:', error);

    // If MCP sampling fails, update mode and fall back to direct API
    if (this.samplingMode === 'mcp') {
      console.warn('[Sampling] Falling back to direct Anthropic API');
      this.samplingMode = 'direct';
    }

    return null;
  }
}
```

### 3. Update Main Request Handler (Hybrid Logic)

```typescript
// src/sampling-bridge-server.ts - in handleRequest()

// After validation, before calling Claude:

let llmResponse: LLMResponse;
let tokensUsed = 0;

// Try MCP sampling first if available
if (this.samplingMode === 'mcp') {
  const mcpResponse = await this.callViaMCPSampling(
    body.messages,
    model,
    maxTokens,
    body.systemPrompt
  );

  if (mcpResponse) {
    llmResponse = mcpResponse;
    // MCP SDK might not report token usage, estimate conservatively
    tokensUsed = maxTokens; // Conservative estimate
    console.log('[Sampling] MCP sampling succeeded');
  } else {
    // MCP failed, fall back to direct API
    if (!this.anthropic) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'MCP sampling unavailable and no Anthropic API key configured. ' +
               'Set ANTHROPIC_API_KEY environment variable to use direct API.'
      }));
      return;
    }

    console.log('[Sampling] Falling back to direct Anthropic API');
    llmResponse = await this.callViaAnthropicAPI(
      body.messages,
      model,
      maxTokens,
      body.systemPrompt
    );
    tokensUsed = llmResponse.usage.inputTokens + llmResponse.usage.outputTokens;
  }
} else {
  // Direct API mode
  if (!this.anthropic) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Anthropic API key required. Set ANTHROPIC_API_KEY environment variable.'
    }));
    return;
  }

  llmResponse = await this.callViaAnthropicAPI(
    body.messages,
    model,
    maxTokens,
    body.systemPrompt
  );
  tokensUsed = llmResponse.usage.inputTokens + llmResponse.usage.outputTokens;
}

// Continue with content filtering and response...
```

### 4. Refactor Direct API Call (Extract Method)

```typescript
// src/sampling-bridge-server.ts

/**
 * Call Claude via direct Anthropic API
 *
 * @returns LLMResponse
 */
private async callViaAnthropicAPI(
  messages: LLMMessage[],
  model: string,
  maxTokens: number,
  systemPrompt?: string
): Promise<LLMResponse> {
  const anthropicMessages = this.convertMessagesToAnthropic(messages);

  const claudeResponse = await this.anthropic.messages.create({
    model,
    max_tokens: maxTokens,
    messages: anthropicMessages,
    ...(systemPrompt && { system: systemPrompt }),
  });

  return {
    content: claudeResponse.content.map(item => {
      if (item.type === 'text') {
        return { type: 'text', text: item.text };
      }
      return { type: 'text', text: JSON.stringify(item) };
    }),
    stopReason: claudeResponse.stop_reason || undefined,
    model: claudeResponse.model,
    usage: {
      inputTokens: claudeResponse.usage.input_tokens,
      outputTokens: claudeResponse.usage.output_tokens
    }
  };
}
```

## User Experience

### Scenario 1: Using Claude Desktop (Best Experience)

```bash
# User just installs code-executor-mcp
# No API key needed!

mcp install code-executor-mcp
```

**What happens:**
- MCP sampling auto-detected ✅
- Uses Claude Desktop's auth ✅
- Covered by user's $20/month subscription ✅
- No additional cost ✅

### Scenario 2: Standalone / CI/CD (Fallback)

```bash
# User exports API key
export ANTHROPIC_API_KEY=sk-ant-...

# Then uses code-executor-mcp
```

**What happens:**
- MCP sampling unavailable (no Claude Desktop) ⚠️
- Falls back to direct API ✅
- User pays per-token (~$3/1M tokens) 💰
- Still works! ✅

### Scenario 3: Neither Available (Error)

```bash
# No Claude Desktop, no API key
# User tries to use sampling
```

**What happens:**
- Clear error message: "MCP sampling unavailable and no API key. See docs." ❌
- Sampling disabled ❌
- Other features (tool calling) still work ✅

## Benefits of Hybrid Approach

### For Users:
1. **Best case:** Free sampling via Claude Desktop (no setup)
2. **Fallback:** Works standalone with API key (flexibility)
3. **Clear errors:** Never silent failures

### For You:
1. **No costs:** MCP mode = free, direct mode = user pays
2. **Wider adoption:** Works in more environments
3. **Future-proof:** As MCP sampling matures, we're ready

### For Enterprise:
1. **Flexibility:** Can choose deployment mode
2. **Cost control:** Can use API keys with budgets
3. **Compliance:** Can run air-gapped with API proxy

## Migration Path

### Phase 1: Implement Hybrid (This Sprint)
- Add MCP sampling method
- Add auto-detection logic
- Keep direct API as fallback
- Test both paths

### Phase 2: Optimize MCP Path (Next Sprint)
- Handle streaming via MCP SDK
- Better error messages
- Token counting for MCP mode
- Performance optimizations

### Phase 3: Monitor Usage (Production)
- Track which mode users prefer
- Collect metrics: MCP success rate vs. direct API
- Optimize based on real data

## Implementation Checklist

- [ ] Update `SamplingBridgeServer` constructor with detection
- [ ] Add `detectSamplingMode()` method
- [ ] Add `callViaMCPSampling()` method
- [ ] Refactor existing code to `callViaAnthropicAPI()`
- [ ] Update `handleRequest()` with hybrid logic
- [ ] Make ANTHROPIC_API_KEY optional (warn if MCP unavailable + no key)
- [ ] Add logging for mode detection and fallback
- [ ] Update tests for both modes
- [ ] Document both deployment scenarios
- [ ] Add troubleshooting guide

## Estimated Effort

- **Detection logic:** 2 hours
- **MCP sampling method:** 3 hours
- **Refactor existing code:** 2 hours
- **Testing:** 3 hours
- **Documentation:** 2 hours

**Total:** ~12 hours (1.5 days)

## Risk Mitigation

**Risk:** MCP sampling spec changes
- **Mitigation:** Direct API fallback ensures it always works

**Risk:** MCP SDK bugs
- **Mitigation:** Catch errors, log warnings, fall back gracefully

**Risk:** Users confused about which mode
- **Mitigation:** Clear logging on startup: "Using MCP sampling" or "Using direct API"

**Risk:** Token counting inaccurate in MCP mode
- **Mitigation:** Conservative estimates, document limitation

---

**Status:** Ready to implement
**Approval:** Pending your confirmation, My Lord
