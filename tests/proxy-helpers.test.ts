/**
 * Unit tests for proxy-helpers (AllowlistValidator + ToolCallTracker)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AllowlistValidator, ToolCallTracker } from '../src/proxy-helpers.js';

describe('AllowlistValidator', () => {
  describe('validate', () => {
    it('should_throw_when_tool_not_in_allowlist', () => {
      const validator = new AllowlistValidator(['mcp__zen__codereview']);

      expect(() => validator.validate('mcp__evil__hack'))
        .toThrow(/not in allowlist/);
    });

    it('should_not_throw_when_tool_in_allowlist', () => {
      const validator = new AllowlistValidator(['mcp__zen__codereview']);

      expect(() => validator.validate('mcp__zen__codereview'))
        .not.toThrow();
    });

    it('should_throw_with_suggestion_in_error_message', () => {
      const validator = new AllowlistValidator(['mcp__zen__codereview']);

      expect(() => validator.validate('mcp__filesystem__read'))
        .toThrow(/Add 'mcp__filesystem__read' to allowedTools array/);
    });

    it('should_handle_empty_allowlist', () => {
      const validator = new AllowlistValidator([]);

      expect(() => validator.validate('mcp__any__tool'))
        .toThrow(/not in allowlist/);
    });

    it('should_handle_multiple_allowed_tools', () => {
      const validator = new AllowlistValidator([
        'mcp__zen__codereview',
        'mcp__filesystem__read',
        'mcp__fetcher__fetch'
      ]);

      expect(() => validator.validate('mcp__zen__codereview')).not.toThrow();
      expect(() => validator.validate('mcp__filesystem__read')).not.toThrow();
      expect(() => validator.validate('mcp__fetcher__fetch')).not.toThrow();
      expect(() => validator.validate('mcp__evil__tool')).toThrow();
    });
  });

  describe('isAllowed', () => {
    it('should_return_true_when_tool_in_allowlist', () => {
      const validator = new AllowlistValidator(['mcp__zen__codereview']);

      expect(validator.isAllowed('mcp__zen__codereview')).toBe(true);
    });

    it('should_return_false_when_tool_not_in_allowlist', () => {
      const validator = new AllowlistValidator(['mcp__zen__codereview']);

      expect(validator.isAllowed('mcp__evil__hack')).toBe(false);
    });

    it('should_not_throw_for_invalid_tool', () => {
      const validator = new AllowlistValidator(['mcp__zen__codereview']);

      expect(() => validator.isAllowed('invalid_tool')).not.toThrow();
      expect(validator.isAllowed('invalid_tool')).toBe(false);
    });
  });
});

describe('ToolCallTracker', () => {
  let tracker: ToolCallTracker;

  beforeEach(() => {
    tracker = new ToolCallTracker();
  });

  describe('track', () => {
    it('should_track_single_tool_call', () => {
      tracker.track('mcp__zen__codereview');

      expect(tracker.getCalls()).toEqual(['mcp__zen__codereview']);
    });

    it('should_track_multiple_tool_calls_in_order', () => {
      tracker.track('mcp__zen__codereview');
      tracker.track('mcp__filesystem__read');
      tracker.track('mcp__fetcher__fetch');

      expect(tracker.getCalls()).toEqual([
        'mcp__zen__codereview',
        'mcp__filesystem__read',
        'mcp__fetcher__fetch'
      ]);
    });

    it('should_track_duplicate_calls', () => {
      tracker.track('mcp__zen__codereview');
      tracker.track('mcp__zen__codereview');

      expect(tracker.getCalls()).toEqual([
        'mcp__zen__codereview',
        'mcp__zen__codereview'
      ]);
    });
  });

  describe('getCalls', () => {
    it('should_return_empty_array_initially', () => {
      expect(tracker.getCalls()).toEqual([]);
    });

    it('should_return_defensive_copy', () => {
      tracker.track('mcp__zen__codereview');

      const calls1 = tracker.getCalls();
      const calls2 = tracker.getCalls();

      // Modifying returned array should not affect tracker
      calls1.push('mcp__evil__mutation');

      expect(calls2).toEqual(['mcp__zen__codereview']);
      expect(tracker.getCalls()).toEqual(['mcp__zen__codereview']);
    });
  });

  describe('clear', () => {
    it('should_clear_all_tracked_calls', () => {
      tracker.track('mcp__zen__codereview');
      tracker.track('mcp__filesystem__read');

      tracker.clear();

      expect(tracker.getCalls()).toEqual([]);
    });

    it('should_allow_tracking_after_clear', () => {
      tracker.track('mcp__zen__codereview');
      tracker.clear();
      tracker.track('mcp__filesystem__read');

      expect(tracker.getCalls()).toEqual(['mcp__filesystem__read']);
    });
  });

  describe('getUniqueCalls', () => {
    it('should_return_unique_tool_names_only', () => {
      tracker.track('mcp__zen__codereview');
      tracker.track('mcp__filesystem__read');
      tracker.track('mcp__zen__codereview');
      tracker.track('mcp__fetcher__fetch');
      tracker.track('mcp__filesystem__read');

      const unique = tracker.getUniqueCalls();

      expect(unique).toHaveLength(3);
      expect(unique).toContain('mcp__zen__codereview');
      expect(unique).toContain('mcp__filesystem__read');
      expect(unique).toContain('mcp__fetcher__fetch');
    });

    it('should_return_empty_array_when_no_calls', () => {
      expect(tracker.getUniqueCalls()).toEqual([]);
    });

    it('should_return_defensive_copy', () => {
      tracker.track('mcp__zen__codereview');

      const unique1 = tracker.getUniqueCalls();
      unique1.push('mcp__evil__mutation');

      expect(tracker.getUniqueCalls()).toEqual(['mcp__zen__codereview']);
    });
  });
});
