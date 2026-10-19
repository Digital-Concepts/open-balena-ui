/// <reference types="@testing-library/jest-dom" />
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FormProvider, useForm } from 'react-hook-form';

vi.mock('react-admin', async (importOriginal) => {
  const R = React;
  const passthrough = ({ children }: any) => R.createElement('div', null, children);
  return {
    ...(await importOriginal<typeof import('react-admin')>()),
    useRecordContext: () => ({ id: 5 }),
    ReferenceManyField: passthrough,
    SingleFieldList: passthrough,
    ReferenceField: passthrough,
    TextField: () => null,
  };
});
vi.mock('../../ui/ManageOrganizations', () => ({ default: () => <div>manage-orgs</div> }));
vi.mock('../../ui/ManageRoles', () => ({ default: () => <div>manage-roles</div> }));
vi.mock('../../ui/ManagePermissions', () => ({ default: () => <div>manage-perms</div> }));

import { AdvancedSection } from '../user';
import { UserAccountContext } from '../../ui/UserAccountType';

const Form = ({ chosen, children }: { chosen?: any; children: React.ReactNode }) => {
  const methods = useForm({ defaultValues: { accountChoice: chosen } });
  return <FormProvider {...methods}>{children}</FormProvider>;
};

const withAccount = (account: any, status: 'ready' | 'loading' | 'error' = 'ready', chosen?: any) =>
  render(
    <Form chosen={chosen}>
      <UserAccountContext.Provider value={{ status, account, reload: () => {} }}>
        <AdvancedSection />
      </UserAccountContext.Provider>
    </Form>,
  );

describe('AdvancedSection', () => {
  it('customer: read-only, no mapping editors', () => {
    withAccount({ type: 'customer', orgId: 1, effectivePermissionSetId: 2 });
    expect(screen.getByTestId('advanced-readonly')).toBeInTheDocument();
    expect(screen.queryByText('manage-orgs')).not.toBeInTheDocument();
    expect(screen.queryByText('manage-roles')).not.toBeInTheDocument();
    expect(screen.queryByText('manage-perms')).not.toBeInTheDocument();
  });
  it('internal: editors present', () => {
    withAccount({ type: 'internal', permissionSetId: null });
    expect(screen.getByText('manage-orgs')).toBeInTheDocument();
    expect(screen.getByText('manage-roles')).toBeInTheDocument();
    expect(screen.getByText('manage-perms')).toBeInTheDocument();
  });
  it('not loaded: no editors', () => {
    withAccount(null, 'error');
    expect(screen.queryByText('manage-orgs')).not.toBeInTheDocument();
  });
  it('internal switched to customer in the form: read-only, no mapping editors', () => {
    withAccount({ type: 'internal', permissionSetId: null }, 'ready', {
      type: 'customer',
      orgId: '1',
      permissionSetId: '',
    });
    expect(screen.getByTestId('advanced-readonly')).toBeInTheDocument();
    expect(screen.queryByText('manage-orgs')).not.toBeInTheDocument();
  });
});
