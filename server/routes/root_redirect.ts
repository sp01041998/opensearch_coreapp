import psl from 'psl';
import { ALLOWED_DOMAINS } from '../../common/constant';
import { validateAccessToken } from '../services/cognito_service';
import { getTenantAccountsByTenantId } from '../services/tenant_validation_service';

const REGION = process.env.REGION;

export function registerRootRedirectRoute(core) {

  const router = core.http.createRouter('/');

  router.get({ path: '/', validate: false },
    async (context, req, res) => {
      // 1. IFRAME CHECK
      const fetchDest = req.headers['sec-fetch-dest'] || '';
      const isIframe = fetchDest === 'iframe';

      const refererUrl = Array.isArray(req.headers?.referer)
        ? req.headers.referer[0]
        : req.headers?.referer || '';

      let refererDomain = '';
      if (refererUrl) {
        const hostname = new URL(refererUrl).hostname;
        const parsed = psl.parse(hostname);
        refererDomain = parsed?.domain || '';
      }

      if (!isIframe) {
        return res.forbidden({
          body: { message: 'Direct Access Denied' },
        });
      }

      if (refererDomain && !ALLOWED_DOMAINS.includes(refererDomain)) {
        return res.forbidden({
          body: { message: 'Invalid Referer' },
        });
      }

      // 2. TOKEN EXTRACTION
      const idToken = req.query?.idToken;
      const accessToken = req.query?.accessToken;
      let tenantId = req.query?.tenantId;
      const unfilteredTenantId = tenantId;

      const currentUser = { email: '', role: '' };

      // validate Cognito access token
      if (!(await validateAccessToken(accessToken, currentUser))) {
        return res.unauthorized({
          body: { message: 'Invalid Access Token' },
        });
      }

      if (!idToken || !accessToken || !currentUser.email) {
        return res.badRequest({
          body: { message: 'Missing Token or Email' },
        });
      }

      if (!tenantId || tenantId === '*') {
        return res.badRequest({
          body: { message: 'Missing Tenant ID' },
        });
      }

      // 3. TENANT ACCOUNT VALIDATION
      let tenantAccounts;
      try {
        tenantAccounts = await getTenantAccountsByTenantId({ tenantId });
      } catch {
        return res.badRequest({
          body: { message: 'Account Details Not Found' },
        });
      }

      if (!tenantAccounts) {
        return res.badRequest({
          body: { message: 'Account Details Not Found' },
        });
      }

      const matchedUser = tenantAccounts.users.find(
        (u) => u.email?.trim()?.toLowerCase() === currentUser.email
      );

      currentUser.role = matchedUser?.role ?? '';

      // 4. CLEAN TENANT ID
      if (tenantId.includes(`${REGION}:`)) {
        tenantId = tenantId.replace(`${REGION}:`, '');
      }

      // 5. BUILD REDIRECT URL
      const basePath = core.http.basePath.get(req);
      const url = `${basePath}/app/dashboards?idToken=${idToken}&accessToken=${accessToken}&tenantId=${tenantId}&email=${currentUser.email}`;

      // 6. SET COOKIES AND REDIRECT
      return res.redirected({
        headers: {
          location: url,
          'set-cookie': [
            `idToken=${idToken}; SameSite=Lax; Path=/aq-dashboard; Max-Age=7200`,
            `accessToken=${accessToken}; SameSite=Lax; Path=/aq-dashboard; Max-Age=7200`,
            `tenantId=${tenantId}; SameSite=Lax; Path=/aq-dashboard; Max-Age=7200`,
            `email=${currentUser.email}; SameSite=Lax; Path=/aq-dashboard; Max-Age=7200`,
            `role=${currentUser.role}; SameSite=Lax; Path=/aq-dashboard; Max-Age=7200`,
            `unfilteredTenantId=${unfilteredTenantId}; SameSite=Lax; Path=/aq-dashboard; Max-Age=7200`,
          ],
        },
      });
    }
    )
  }


