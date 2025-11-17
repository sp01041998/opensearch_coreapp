import { IRouter } from 'opensearch-dashboards/server';
import dotenv from 'dotenv';
import { validateAccessToken, CurrentUser } from '../utils/auth';
import { checkIframeAndReferer } from '../utils/request_guards';

// adjust imports to your paths
import { getTenantAccountsByTenantId, getDashboardsByTenantId } from '../../../../src/core/utils/dbUtils';
import { AQ_CAN_EDIT_ROLES } from '../../../../src/core/common/constants';
import { callESApi } from '../../../../src/core/common/esApi';

dotenv.config();
const REGION = process.env.REGION;
const DASHBOARD_COOKIE_PATH = '/aq-dashboard';

export function registerProxySavedObjectsRoute(router: IRouter) {
  router.get(
    {
      path: '/proxy-saved-objects/view',
      validate: false,
      options: { authRequired: false },
    },
    async (context, req, res) => {
      const basePath = context.coreapp.basePath.get(req);
    //   const basePath = "https://search-dashboard-test-v1-aera734vki7qwjh7frwvieda2i.aos.us-west-2.on.aws/_dashboards"
      const query = req.query as any;

      const idToken = query?.idToken as string | undefined;
      const accessToken = query?.accessToken as string | undefined;
      let tenantId = query?.tenantId as string | undefined;
      const dashboardId = query?.dashboardId as string | undefined;
      const objectType = query?.type as string | undefined;
      const indexPatternId = query?.indexPatternId as string | undefined;
      let isDashboardEdit = query?.isDashboardEdit as string | boolean | undefined;
      const timeFilter = query?.timeFilter || null;
      const integrationGuid = query?.guid || null;
      const unfilteredTenantId = tenantId;

    //   const basePath = "https://search-dashboard-test-v1-aera734vki7qwjh7frwvieda2i.us-west-2.es.amazonaws.com"

      if (typeof isDashboardEdit === 'string') {
        try {
          isDashboardEdit = JSON.parse(isDashboardEdit);
        } catch {
          isDashboardEdit = false;
        }
      }
      const headers = req.headers;

      const guard = checkIframeAndReferer(headers);
      if (!guard.ok) {
        return res.forbidden({ body: guard.errorBody });
      }

      if (!accessToken || !tenantId || !objectType) {
        return res.badRequest({
          body: { message: 'Missing Token(s) or tenantId/type' },
        });
      }

      if (objectType === 'search' && !indexPatternId) {
        return res.badRequest({
          body: { message: 'Missing Index Pattern ID' },
        });
      }

      if (objectType === 'dashboard' && !dashboardId) {
        return res.badRequest({
          body: { message: 'Missing Dashboard ID' },
        });
      }

      if (objectType === 'discover' && !indexPatternId) {
        return res.badRequest({
          body: { message: 'Missing indexPattern Id.' },
        });
      }

      const currentUser: CurrentUser = { email: '', role: '' };

      if (!(await validateAccessToken(accessToken, currentUser))) {
        return res.unauthorized({ body: { message: 'Invalid Access Token' } });
      }

      try {
        const tenantAccounts = await getTenantAccountsByTenantId({ tenantId });
        if (!tenantAccounts || Object.keys(tenantAccounts).length === 0) {
          return res.badRequest({
            body: { message: 'Account Details Not Found' },
          });
        }

        const matchedUser = tenantAccounts.users.find(
          (user: Record<string, any>) =>
            user.email?.trim()?.toLowerCase() === currentUser.email?.trim()?.toLowerCase()
        );

        currentUser.role = matchedUser?.role ?? '';
      } catch (error: any) {
        console.error(error);
        return res.badRequest({
          body: { message: error?.message || 'Account Details Not Found' },
        });
      }

      if (tenantId.includes(`${REGION}:`)) {
        tenantId = tenantId.replace(`${REGION}:`, '');
      }

    //   const basePath = router.basePath.get(req);
      let url = '';

      if (objectType === 'dashboard') {
        const gTime = timeFilter
          ? `&_g=(filters:!(),refreshInterval:(pause:!t,value:0),time:(${timeFilter}))`
          : '';
        const aFilter = integrationGuid
          ? `&_a=(filters:!(('$state':(store:appState),meta:(alias:!n,disabled:!f,index:'${indexPatternId}',key:meta.guid,negate:!f,params:(query:'${integrationGuid}'),type:phrase),query:(match_phrase:(meta.guid:'${integrationGuid}')))))`
          : '';

        url = `${basePath}/app/dashboards#/view/${dashboardId}?${
          AQ_CAN_EDIT_ROLES.includes(currentUser.role) && isDashboardEdit
            ? `${gTime}${aFilter}`
            : `embed=true&show-query-input=true&show-time-filter=true${gTime}${aFilter}`
        }`;
      } else if (objectType === 'search') {
        url = `${basePath}/app/data-explorer/discover#?${
          AQ_CAN_EDIT_ROLES.includes(currentUser.role) ? '' : 'embed=true&'
        }_a=(discover:(columns:!(_source),isDirty:!f,sort:!()),metadata:(indexPattern:'${indexPatternId}',view:discover))&_q=(filters:!(),query:(language:kuery,query:''))&_g=(filters:!(),refreshInterval:(pause:!t,value:0),time:(from:now-30d,to:now))`;
      }  else {
        return res.badRequest({ body: { message: 'Invalid Object Type' } });
      }

      return res.redirected({
        headers: {
          location: url,
          'set-cookie': [
            `accessToken=${accessToken}; SameSite=Lax; Path=${DASHBOARD_COOKIE_PATH}; Max-Age=7200`,
            `tenantId=${tenantId}; SameSite=Lax; Path=${DASHBOARD_COOKIE_PATH}; Max-Age=7200`,
            `idToken=${idToken}; SameSite=Lax; Path=${DASHBOARD_COOKIE_PATH}; Max-Age=7200`,
            `email=${currentUser.email}; SameSite=Lax; Path=${DASHBOARD_COOKIE_PATH}; Max-Age=7200`,
            `unfilteredTenantId=${unfilteredTenantId}; SameSite=Lax; Path=${DASHBOARD_COOKIE_PATH}; Max-Age=7200`,
            `role=${currentUser.role}; SameSite=Lax; Path=${DASHBOARD_COOKIE_PATH}; Max-Age=7200`,
          ],
        },
      });
    }
  );
}
