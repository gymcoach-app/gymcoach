// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

// Smoke test for the component testing stack (jsdom + Testing Library +
// jest-dom matchers + TSX transform). Real component tests are added per
// feature in later batches.
function Greeting({ name }: { name: string }) {
  return <p>Hello {name}</p>;
}

describe('component testing stack', () => {
  it('renders a component into the jsdom DOM', () => {
    render(<Greeting name="GymCoach" />);
    expect(screen.getByText('Hello GymCoach')).toBeInTheDocument();
  });
});
