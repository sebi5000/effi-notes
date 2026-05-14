import { describe, expect, it } from 'vitest';
import { initialSaveState, reduceSaveState } from './save-state.ts';

describe('reduceSaveState', () => {
  it('starts idle', () => {
    expect(initialSaveState).toBe('idle');
  });

  it('edit moves idle → dirty', () => {
    expect(reduceSaveState('idle', { kind: 'edit' })).toBe('dirty');
  });

  it('save-start from dirty goes to saving', () => {
    expect(reduceSaveState('dirty', { kind: 'save-start' })).toBe('saving');
  });

  it('save-start from idle or saved is a no-op', () => {
    expect(reduceSaveState('idle', { kind: 'save-start' })).toBe('idle');
    expect(reduceSaveState('saved', { kind: 'save-start' })).toBe('saved');
  });

  it('save-ok moves to saved', () => {
    expect(reduceSaveState('saving', { kind: 'save-ok' })).toBe('saved');
  });

  it('save-conflict moves to conflict from any state', () => {
    expect(reduceSaveState('saving', { kind: 'save-conflict' })).toBe('conflict');
    expect(reduceSaveState('dirty', { kind: 'save-conflict' })).toBe('conflict');
  });

  it('edits during conflict stay in conflict until resolved', () => {
    expect(reduceSaveState('conflict', { kind: 'edit' })).toBe('conflict');
  });

  it('save-network-error → offline', () => {
    expect(reduceSaveState('saving', { kind: 'save-network-error' })).toBe('offline');
  });

  it('recovered from offline returns to dirty', () => {
    expect(reduceSaveState('offline', { kind: 'recovered' })).toBe('dirty');
    // From other states recovered is a no-op
    expect(reduceSaveState('idle', { kind: 'recovered' })).toBe('idle');
  });

  it('reset returns to idle', () => {
    expect(reduceSaveState('conflict', { kind: 'reset' })).toBe('idle');
    expect(reduceSaveState('offline', { kind: 'reset' })).toBe('idle');
    expect(reduceSaveState('saved', { kind: 'reset' })).toBe('idle');
  });
});
