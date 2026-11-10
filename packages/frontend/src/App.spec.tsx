import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// jsdom has no Web Workers; render the dashboard in the engine's loading state.
vi.mock('@/engine/use-model-engine', () => ({
  useModelEngine: () => ({
    status: 'loading', snapshot: null, info: null, error: null,
    setOverride: vi.fn(), resetOverride: vi.fn(), resetAll: vi.fn(),
  }),
}));

import App from '@/App';

describe('App', () => {
  it('renders the report shell while the model loads', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Pacific Private Money' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Report pages' })).toHaveTextContent('Bid Summary');
    expect(screen.getAllByText('Loading the model…').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Export to Excel/ })).toBeDisabled();
  });
});
