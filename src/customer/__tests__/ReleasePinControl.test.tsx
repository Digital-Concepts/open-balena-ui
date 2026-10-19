import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';

const notify = vi.fn();
vi.mock('react-admin', () => ({
  useRecordContext: () => ({ uuid: 'abc', 'is pinned on-release': null }),
  useNotify: () => notify,
  useRefresh: () => vi.fn(),
}));
vi.mock('../api', () => ({ customerApi: vi.fn(() => Promise.reject(new Error('boom'))) }));

import ReleasePinControl from '../widgets/ReleasePinControl';

describe('ReleasePinControl', () => {
  it('shows an error and disables Save when releases fail to load', async () => {
    render(<ReleasePinControl />);
    await waitFor(() => expect(screen.queryByText(/Could not load releases: boom/)).not.toBeNull());
    expect(notify).toHaveBeenCalledWith('boom', { type: 'error' });
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
