import { IRouter } from 'opensearch-dashboards/server';
import dotenv from 'dotenv';
import { validateAccessToken, CurrentUser } from '../utils/auth';
import { checkIframeAndReferer } from '../utils/request_guards';

// adjust these imports to match where your helpers live
import { getTenantAccountsByTenantId } from '../../../../src/core/utils/dbUtils';
import { AQ_CAN_EDIT_ROLES } from '../../../../src/core/common/constants';
import { getDashboardsByTenantId } from '../../../../src/core/utils/dbUtils';
import { callESApi } from '../../../../src/core/common/esApi';

dotenv.config();
const REGION = process.env.REGION;
const DASHBOARD_COOKIE_PATH = '/aq-dashboard';

export function registerRootRedirectRoute(router: IRouter) {
  router.get(
    {
      path: '/aq-default',
      validate: false,
      options: { authRequired: false },
    },
    async (context, req, res) => {
      // iframe + referer checks
      const guard = checkIframeAndReferer(req.headers);
      if (!guard.ok) {
        return res.forbidden({ body: guard.errorBody });
      }

      const idToken = (req.query as any)?.idToken as string | undefined;
      const accessToken = (req.query as any)?.accessToken as string | undefined;
      let tenantId = (req.query as any)?.tenantId as string | undefined;
      const unfilteredTenantId = tenantId;
      const currentUser: CurrentUser = { email: '', role: '' };

      // validate token
      const valid = await validateAccessToken(accessToken, currentUser);
      if (!valid || !currentUser.email) {
        return res.unauthorized({
          body: { message: 'Invalid Access Token or Missing Email' },
        });
      }

      if (!idToken || !accessToken) {
        return res.badRequest({
          body: { message: 'Missing Token(s)' },
        });
      }

      if (!tenantId || tenantId === '*') {
        return res.badRequest({
          body: { message: 'Missing Tenant ID' },
        });
      }

      try {
        const tenantAccounts = await getTenantAccountsByTenantId({ tenantId });
        if (!tenantAccounts) {
          return res.badRequest({
            body: { message: 'Account Details Not Found' },
          });
        }

        const matchedUser = tenantAccounts.users.find(
          (user: Record<string, any>) =>
            user.email?.trim()?.toLowerCase() === currentUser.email?.trim()?.toLowerCase()
        );

        currentUser.role = matchedUser?.role ?? '';
      } catch (error) {
        console.error(error);
        return res.badRequest({
          body: { message: 'Account Details Not Found' },
        });
      }

      if (tenantId.includes(`${REGION}:`)) {
        tenantId = tenantId.replace(`${REGION}:`, '');
      }

      const basePath = context.core.http.basePath.get(req);
      const url = `${basePath}/app/dashboards?idToken=${idToken}&accessToken=${accessToken}&tenantId=${tenantId}&email=${currentUser.email}`;

      return res.redirected({
        headers: {
          location: url,
          'set-cookie': [
            `idToken=${idToken}; SameSite=Lax; Path=${DASHBOARD_COOKIE_PATH}; Max-Age=7200`,
            `accessToken=${accessToken}; SameSite=Lax; Path=${DASHBOARD_COOKIE_PATH}; Max-Age=7200`,
            `tenantId=${tenantId}; SameSite=Lax; Path=${DASHBOARD_COOKIE_PATH}; Max-Age=7200`,
            `email=${currentUser.email}; SameSite=Lax; Path=${DASHBOARD_COOKIE_PATH}; Max-Age=7200`,
            `role=${currentUser.role}; SameSite=Lax; Path=${DASHBOARD_COOKIE_PATH}; Max-Age=7200`,
            `unfilteredTenantId=${unfilteredTenantId}; SameSite=Lax; Path=${DASHBOARD_COOKIE_PATH}; Max-Age=7200`,
          ],
        },
      });
    }
  );
}
