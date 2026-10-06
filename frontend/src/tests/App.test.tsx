/**
 * App shell smoke test (placeholder until the real screens arrive in milestones 8-9).
 * - Renders the product name
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../App';

describe('App', () => {
  it('renders the product name', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'PulseCheck' })).toBeInTheDocument();
  });
});
