// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpSection } from './mcp-section';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('McpSection', () => {
  it('formats the last-used date through the app formatter', () => {
    const browserDateFormatter = vi
      .spyOn(Date.prototype, 'toLocaleDateString')
      .mockImplementation(() => {
        throw new Error('Browser-default date formatting must not run during hydration.');
      });

    render(
      <McpSection
        initialTokens={[
          {
            id: 'token-1',
            name: 'ChatGPT',
            tokenPrefix: 'gmc_test',
            canWrite: true,
            createdAt: '2026-01-01T00:00:00.000Z',
            lastUsedAt: '2026-01-02T23:30:00.000Z',
          },
        ]}
      />,
    );

    expect(screen.getByText(/used 01\/02\/2026/u)).toBeInTheDocument();
    expect(browserDateFormatter).not.toHaveBeenCalled();
  });
});
