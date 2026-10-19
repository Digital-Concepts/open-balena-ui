/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useForm, FormProvider } from 'react-hook-form';
import { act, render, screen, waitFor, fireEvent, within } from '@testing-library/react';

const notify = vi.fn();
let formValues: any;
let resetForm: () => void;
vi.mock('react-admin', () => ({
  useNotify: () => notify,
  useRecordContext: () => ({ id: 5 }),
  useGetList: (resource: string) =>
    resource === 'organization'
      ? {
          data: [
            { id: 1, name: 'Acme' },
            { id: 2, name: 'Internal GmbH' },
          ],
        }
      : { data: [{ id: 9, name: 'Operator' }] },
}));

import UserAccountType, { UserAccountProvider } from '../UserAccountType';

const json = (body: any, ok = true) => ({ ok, json: async () => body });
const stubApi = (account: any, put = vi.fn(async (_u: string, _i: any) => json({}))) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: any) => {
      if (init?.method === 'PUT') return put(url, init);
      if (url.includes('/org-settings'))
        return json({
          data: [
            { orgId: 1, isCustomer: true, permissionSetId: 9, userCount: 0 },
            { orgId: 2, isCustomer: false, permissionSetId: null, userCount: 0 },
          ],
        });
      return json(account);
    }),
  );
  return put;
};
const Form = ({ children }: { children: React.ReactNode }) => {
  const methods = useForm();
  formValues = methods.watch;
  resetForm = methods.reset;
  return <FormProvider {...methods}>{children}</FormProvider>;
};
const renderPanel = () =>
  render(
    <Form>
      <UserAccountProvider userId={5}>
        <UserAccountType />
      </UserAccountProvider>
    </Form>,
  );

beforeEach(() => notify.mockClear());
afterEach(() => vi.unstubAllGlobals());

describe('UserAccountType', () => {
  it('has no save button of its own and seeds the form field', async () => {
    stubApi({ type: 'internal', permissionSetId: 9 });
    renderPanel();
    await screen.findByRole('combobox', { name: /permission set/i });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(formValues('accountChoice')).toEqual({ type: 'internal', orgId: '', permissionSetId: '9' });
  });

  it('failed load notifies, shows no controls', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ message: 'boom' }, false)),
    );
    renderPanel();
    await waitFor(() => expect(notify).toHaveBeenCalledWith('boom', { type: 'error' }));
    expect(screen.getByText('Could not load — reload the page')).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(formValues('accountChoice')).toBeUndefined();
  });

  it('customer org select lists only customer orgs', async () => {
    stubApi({ type: 'customer', orgId: 1, effectivePermissionSetId: 9 });
    renderPanel();
    const combo = await screen.findByRole('combobox', { name: /customer org/i });
    fireEvent.mouseDown(combo);
    const list = within(await screen.findByRole('listbox'));
    expect(list.getByText('Acme')).toBeInTheDocument();
    expect(list.queryByText('Internal GmbH')).not.toBeInTheDocument();
  });

  it('switching the type updates the form field', async () => {
    stubApi({ type: 'customer', orgId: 1, effectivePermissionSetId: 9 });
    renderPanel();
    await screen.findByRole('combobox', { name: /customer org/i });
    fireEvent.click(screen.getByRole('radio', { name: 'Internal' }));
    await waitFor(() => expect(formValues('accountChoice').type).toBe('internal'));
  });

  it('re-seeds the field after a form reset', async () => {
    stubApi({ type: 'internal', permissionSetId: 9 });
    renderPanel();
    await screen.findByRole('combobox', { name: /permission set/i });
    act(() => resetForm());
    await waitFor(() =>
      expect(formValues('accountChoice')).toEqual({ type: 'internal', orgId: '', permissionSetId: '9' }),
    );
    expect(screen.getByRole('combobox', { name: /permission set/i })).toBeInTheDocument();
  });
});
