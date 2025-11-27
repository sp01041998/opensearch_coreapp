/*
 * Copyright OpenSearch Contributors
 * SPDX-License-Identifier: Apache-2.0
 */

import { getTenantAccountsByTenantId } from '../services/tenant_validation_service';

const validateCurrentUserByTenantId = async (
  tenantId: string,
  currentUserEmail: string
): Promise<boolean> => {
  try {
    if (!tenantId || !currentUserEmail) {
      throw new Error('tenantId or Email Required');
    }
    const tenantAccounts = await getTenantAccountsByTenantId({ tenantId });
    if (!tenantAccounts) {
      throw new Error('Account Details Not Found');
    }
    const isValidCurrentUser =
      tenantAccounts?.users?.filter(
        (user: Record<string, any>) =>
          user.email?.trim()?.toLowerCase() === currentUserEmail?.trim()?.toLowerCase()
      )?.length > 0;
    return isValidCurrentUser;
  } catch (error) {
    console.error(error);
    throw error;
  }
};
export { validateCurrentUserByTenantId };
