import { describe, it, expect } from 'vitest';
import { CUSTOMER_RESOURCES } from '../customerDataProvider';

describe('audit resource', () => {
  it('is admin only', () => {
    expect(CUSTOMER_RESOURCES).not.toContain('audit');
  });
});
