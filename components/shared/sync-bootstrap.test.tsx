import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

const { bindAutoSync, pruneSyncedSets } = vi.hoisted(() => ({
  bindAutoSync: vi.fn((_userId: string | null) => () => undefined),
  pruneSyncedSets: vi.fn(async () => 0),
}));

vi.mock('@/lib/sync', () => ({ bindAutoSync, pruneSyncedSets }));

import { SyncBootstrap } from './sync-bootstrap';

describe('SyncBootstrap (#490)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    bindAutoSync.mockClear();
  });

  it('binds the auto-sync to the account the layout was rendered for and records it', () => {
    render(<SyncBootstrap userId="user-a" />);

    expect(bindAutoSync).toHaveBeenCalledWith('user-a');
    expect(window.localStorage.getItem('gymcoach-signed-in-account')).toBe('user-a');
  });

  it('records nothing and binds a no-op without a session', () => {
    render(<SyncBootstrap userId={null} />);

    expect(bindAutoSync).toHaveBeenCalledWith(null);
    expect(window.localStorage.getItem('gymcoach-signed-in-account')).toBeNull();
  });

  it('rebinds when the layout renders for another account', () => {
    const view = render(<SyncBootstrap userId="user-a" />);
    view.rerender(<SyncBootstrap userId="user-b" />);

    expect(bindAutoSync).toHaveBeenLastCalledWith('user-b');
    expect(window.localStorage.getItem('gymcoach-signed-in-account')).toBe('user-b');
  });
});
