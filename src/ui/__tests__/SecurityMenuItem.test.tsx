/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('react-admin', () => ({
  MenuItemLink: (props: any) => (
    <a data-severity={props['data-severity']} data-color={props.sx?.backgroundColor}>{props.primaryText}</a>
  ),
}));
const api = { getLatest: vi.fn() };
vi.mock('../../lib/securityApi', () => ({ useSecurityApi: () => api }));

import SecurityMenuItem from '../SecurityMenuItem';

beforeEach(() => vi.clearAllMocks());

describe('SecurityMenuItem', () => {
  it('tints with the highest severity from the latest run', async () => {
    api.getLatest.mockResolvedValue({ totals: { critical: 0, high: 3, medium: 1, low: 0, unknown: 0 } });
    render(<SecurityMenuItem resource={{ name: 'security' }} primaryText="Vulnerabilities" />);
    const link = await screen.findByText('Vulnerabilities');
    await waitFor(() => expect(link).toHaveAttribute('data-severity', 'high'));
    expect(link).toHaveAttribute('data-color'); // a muted colour was applied
  });

  it('critical wins over lower severities', async () => {
    api.getLatest.mockResolvedValue({ totals: { critical: 2, high: 9, medium: 0, low: 0 } });
    render(<SecurityMenuItem resource={{ name: 'security' }} primaryText="Vulnerabilities" />);
    const link = await screen.findByText('Vulnerabilities');
    await waitFor(() => expect(link).toHaveAttribute('data-severity', 'critical'));
  });

  it('no tint when the latest run is clean', async () => {
    api.getLatest.mockResolvedValue({ totals: { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 } });
    render(<SecurityMenuItem resource={{ name: 'security' }} primaryText="Vulnerabilities" />);
    const link = await screen.findByText('Vulnerabilities');
    await waitFor(() => expect(link).toHaveAttribute('data-severity', 'none'));
    expect(link).not.toHaveAttribute('data-color');
  });

  it('survives a failed getLatest (no tint)', async () => {
    api.getLatest.mockRejectedValue(new Error('boom'));
    render(<SecurityMenuItem resource={{ name: 'security' }} primaryText="Vulnerabilities" />);
    const link = await screen.findByText('Vulnerabilities');
    expect(link).toHaveAttribute('data-severity', 'none');
  });
});
