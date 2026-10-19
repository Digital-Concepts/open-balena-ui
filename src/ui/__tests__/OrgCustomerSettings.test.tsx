/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { useForm, FormProvider } from 'react-hook-form';

const notify = vi.fn();
vi.mock('react-admin', () => ({
  useNotify: () => notify,
  useRecordContext: () => ({ id: 3 }),
  useGetList: () => ({ data: [{ id: 9, name: 'Operator' }] }),
}));

import OrgCustomerSettings, { OrgSettingsProvider } from '../OrgCustomerSettings';

let watch: (n: string) => any;
let resetForm: () => void;
const Form = ({ children }: { children: React.ReactNode }) => {
  const methods = useForm();
  watch = methods.watch;
  resetForm = methods.reset;
  return <FormProvider {...methods}>{children}</FormProvider>;
};
const renderPanel = () =>
  render(
    <Form>
      <OrgSettingsProvider>
        <OrgCustomerSettings />
      </OrgSettingsProvider>
    </Form>,
  );

beforeEach(() => notify.mockClear());
afterEach(() => vi.unstubAllGlobals());

describe('OrgCustomerSettings', () => {
  it('shows the user count, has no button and seeds the form field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ orgId: 3, isCustomer: true, permissionSetId: 9, userCount: 2 }),
      })),
    );
    renderPanel();
    expect(await screen.findByText('2 users')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
    expect(watch('customerSettings')).toEqual({ permissionSetId: '9' });
  });

  it('has no toggle; choosing a set updates the form field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ orgId: 3, isCustomer: false, permissionSetId: null, userCount: 0 }),
      })),
    );
    renderPanel();
    const combo = await screen.findByRole('combobox', { name: /customer permission set/i });
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByText(/makes this org selectable for customer users/i)).toBeInTheDocument();
    fireEvent.mouseDown(combo);
    expect(screen.getByRole('option', { name: '— not a customer org —' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: 'Operator' }));
    await waitFor(() => expect(watch('customerSettings')).toEqual({ permissionSetId: '9' }));
  });

  it('failed load shows no controls and leaves the field empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({ error: 'nope' }) })),
    );
    renderPanel();
    await waitFor(() => expect(notify).toHaveBeenCalledWith('nope', { type: 'error' }));
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(watch('customerSettings')).toBeUndefined();
  });

  it('re-seeds the field after a form reset', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ orgId: 3, isCustomer: true, permissionSetId: 9, userCount: 2 }),
      })),
    );
    renderPanel();
    await screen.findByText('2 users');
    act(() => resetForm());
    await waitFor(() => expect(watch('customerSettings')).toEqual({ permissionSetId: '9' }));
    expect(screen.getByText('2 users')).toBeInTheDocument();
  });
});
