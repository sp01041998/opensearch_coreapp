// import { validateAccessToken } from './auth';
// import {validateCurrentUserByTenantId} from '../utils/validation'
// import { getRoleSpecificCredentials } from './credentials_service';



// export class AuthService {
// //   constructor(private readonly logger: Logger) {}

//   async getTenantContext(req: OpenSearchDashboardsRequest) {
//     const cookies = req.headers.cookie ?? '';

//     const currentUserEmail = this.extractCookie(cookies, 'email');
//     const tenantId = this.extractCookie(cookies, 'tenantId');
//     const unfilteredTenantId = this.extractCookie(cookies, 'unfilteredTenantId');
//     const accessToken = this.extractCookie(cookies, 'accessToken');

//     // 1. Validate Cognito token
//     const user = await validateAccessToken(accessToken, currentUserEmail);

//     // 2. Validate user belongs to tenant
//     await validateCurrentUserByTenantId(unfilteredTenantId, currentUserEmail);

//     // 3. Assume IAM tenant role
//     const tempCred = await getRoleSpecificCredentials(
//       `arn:aws:iam::${AWS_ACCOUNT_ID}:role/${tenantId}`,
//       `tenantId-${tenantId}`
//     );

//     return {
//       tenantId,
//       email: currentUserEmail,
//       tempCred
//     };
//   }

//   extractCookie(all: string, key: string) {
//     const match = all.match(new RegExp(`${key}=([^;]+)`));
//     return match?.[1] || '';
//   }
// }
