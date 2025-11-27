import { validateCurrentUserByTenantId } from '../utils/validation';
import { getRoleSpecificCredentials } from './credentials_service';

const AWS_ACCOUNT_ID = process.env.AWS_ACCOUNT_ID!;

export class SavedObjectsAuthService {
  async authenticateFromOptions(options: any) {
    const tenantId = options?.query?.tenantId || options?.tenantId;
    const email = options?.query?.email || options?.email;
    const unfilteredTenantId = options?.query?.unfilteredTenantId || options?.unfilteredTenantId;

    if (!tenantId || !email) {
      console.log("Missing tenantId or email in options:", options);
      throw {
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Missing tenantId or email',
      };
    }

    const isValid = await validateCurrentUserByTenantId(
      unfilteredTenantId,
      email
    );

    if (!isValid) {
      throw {
        statusCode: 403,
        error: 'Forbidden',
        message: 'Not authorized',
      };
    }

    const tempCred = await getRoleSpecificCredentials(
      `arn:aws:iam::${AWS_ACCOUNT_ID}:role/${tenantId}`,
      `tenant-${tenantId}`
    );

    return {
      tenantId,
      email,
      tempCred
    };
  }
}
