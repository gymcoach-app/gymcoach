// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Dumbbell } from 'lucide-react';
import { EmptyState } from './empty-state';

describe('EmptyState', () => {
  it('renders the title and description', () => {
    render(
      <EmptyState title="No sessions logged yet" description="Log one to begin." />,
    );
    expect(screen.getByText('No sessions logged yet')).toBeInTheDocument();
    expect(screen.getByText('Log one to begin.')).toBeInTheDocument();
  });

  it('renders the call-to-action as a link to the given href', () => {
    render(
      <EmptyState
        icon={Dumbbell}
        title="Nothing here"
        action={{ label: 'Log your first session', href: '/session/new' }}
      />,
    );
    const cta = screen.getByRole('link', { name: 'Log your first session' });
    expect(cta).toBeInTheDocument();
    expect(cta).toHaveAttribute('href', '/session/new');
  });

  it('renders no link when there is no action', () => {
    render(<EmptyState title="Nothing here" />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
