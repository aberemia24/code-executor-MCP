import { beforeEach, describe, expect, it } from 'vitest';
import { ToolCallTracker } from '../src/proxy-helpers.js';

describe('ToolCallTracker summary aggregation', () => {
  let tracker: ToolCallTracker;

  beforeEach(() => {
    tracker = new ToolCallTracker();
  });

  it('should_aggregate_metrics_per_tool', () => {
    tracker.track('mcp__zen__codereview', {
      durationMs: 10,
      status: 'success',
      timestamp: 1_700_000_000_000,
    });
    tracker.track('mcp__zen__codereview', {
      durationMs: 20,
      status: 'success',
      timestamp: 1_700_000_000_500,
    });
    tracker.track('mcp__filesystem__read', {
      durationMs: 50,
      status: 'error',
      errorMessage: 'Boom',
      timestamp: 1_700_000_001_000,
    });

    const summary = tracker.getSummary();

    expect(summary).toHaveLength(2);

    const zenSummary = summary.find((entry) => entry.toolName === 'mcp__zen__codereview');
    expect(zenSummary).toMatchObject({
      toolName: 'mcp__zen__codereview',
      callCount: 2,
      successCount: 2,
      errorCount: 0,
      totalDurationMs: 30,
      averageDurationMs: 15,
      lastCallDurationMs: 20,
      lastCallStatus: 'success',
      lastErrorMessage: undefined,
      lastCalledAt: new Date(1_700_000_000_500).toISOString(),
    });

    const filesystemSummary = summary.find((entry) => entry.toolName === 'mcp__filesystem__read');
    expect(filesystemSummary).toMatchObject({
      toolName: 'mcp__filesystem__read',
      callCount: 1,
      successCount: 0,
      errorCount: 1,
      totalDurationMs: 50,
      averageDurationMs: 50,
      lastCallDurationMs: 50,
      lastCallStatus: 'error',
      lastErrorMessage: 'Boom',
      lastCalledAt: new Date(1_700_000_001_000).toISOString(),
    });
  });

  it('should_preserve_insertion_order_for_summary_entries', () => {
    tracker.track('mcp__zen__codereview', { durationMs: 5, status: 'success', timestamp: 1 });
    tracker.track('mcp__filesystem__read', { durationMs: 6, status: 'success', timestamp: 2 });

    const summary = tracker.getSummary();
    expect(summary.map((entry) => entry.toolName)).toEqual([
      'mcp__zen__codereview',
      'mcp__filesystem__read',
    ]);
  });

  it('should_return_empty_summary_when_no_calls_tracked', () => {
    expect(tracker.getSummary()).toEqual([]);
  });
});
