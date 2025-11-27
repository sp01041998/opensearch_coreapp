import { IRouter } from 'opensearch-dashboards/server';
import dotenv from 'dotenv';
import { validateAccessToken } from '../services/cognito_service';
import { checkIframeAndReferer } from '../utils/request_guards';

// adjust imports to your paths
import { getTenantAccountsByTenantId } from '../services/tenant_validation_service';
import { AQ_CAN_EDIT_ROLES } from '../../common/constant';

dotenv.config();
const REGION = process.env.REGION;

export function registerProxySavedObjectsRoute(router: IRouter) {
  router.get(
    {
      path: '/proxy-saved-objects/view',
      validate: false,
      options: { authRequired: false },
    },
    async (context, req, res) => {
      const basePath = context.coreapp.basePath.get(req);
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
          body: {
            message: 'Missing Token(s)',
          },
        });
      }

      if (objectType === 'search' && !indexPatternId) {
        return res.badRequest({
          body: {
            message: 'Missing Index Pattern ID',
          },
        });
      }

      if (objectType === 'dashboard' && !dashboardId) {
        return res.badRequest({
          body: {
            message: 'Missing Dashboard ID',
          },
        });
      }

      if (objectType == 'discover' && !indexPatternId) {
        return res.badRequest({
          body: {
            message: 'Missing indexPattern Id.',
          },
        });
      }

      const currentUser: CurrentUser = { email: '', role: '' };

      // validate the accessToken and populate the currentUserEmail
      if (!(await validateAccessToken(accessToken, currentUser))) {
        const error = {
          message: 'Invalid Access Token',
          statusCode: 401,
          error: 'Unauthorized',
        };

        throw error;
      }
      try {
        const tenantAccounts = await getTenantAccountsByTenantId({ tenantId });
        if (Object.keys(tenantAccounts).length <= 0) {
          return res.badRequest({
            body: {
              message: 'Account Details Not Found',
            },
          });
        }

        currentUser.role = tenantAccounts.users.find(
          (user: Record<string, any>) =>
            user.email?.trim()?.toLowerCase() === currentUser.email?.trim()?.toLowerCase()
        ).role;
      } catch (error) {
        console.error(error);
        return res.badRequest({
          body: {
            message: error?.message || 'Account Details Not Found',
          },
        });
      }

      if (tenantId.includes(`${REGION}:`)) {
        tenantId = tenantId.replace(`${REGION}:`, '');
      }
      let url: string = '';
      // const basePath: string = httpSetup.basePath.get(req);
      console.log({ objectType });

      if (objectType === 'dashboard') {
        const gTime = timeFilter
          ? `&_g=(filters:!(),refreshInterval:(pause:!t,value:0),time:(${timeFilter}))`
          : '';
        const aFilter = integrationGuid
          ? `&_a=(filters:!(('$state':(store:appState),meta:(alias:!n,disabled:!f,index:'${indexPatternId}',key:meta.guid,negate:!f,params:(query:'${integrationGuid}'),type:phrase),query:(match_phrase:(meta.guid:'${integrationGuid}')))))`
          : '';

        url = `${basePath}/app/dashboards#/view/${dashboardId}?${AQ_CAN_EDIT_ROLES.includes(currentUser.role) && isDashboardEdit
          ? `${gTime}${aFilter}`
          : `embed=true&show-query-input=true&show-time-filter=true${gTime}${aFilter}`
          }`;
      } else if (objectType === 'search') {
        url = `${basePath}/app/data-explorer/discover#?${AQ_CAN_EDIT_ROLES.includes(currentUser.role) ? '' : 'embed=true&'
          }_a=(discover:(columns:!(_source),isDirty:!f,sort:!()),metadata:(indexPattern:'${indexPatternId}',view:discover))&_q=(filters:!(),query:(language:kuery,query:''))&_g=(filters:!(),refreshInterval:(pause:!t,value:0),time:(from:now-30d,to:now))`;
      } else if (objectType === 'security-analytics') {
        url = `${basePath}/app/opensearch_security_analytics_dashboards#/overview?embed=true`;
      } else if (objectType === 'reporting') {
        console.log('from reporting');
        url = `${basePath}/app/reports-dashboards#?embed=true`;
      } else if (objectType === 'createDashboard') {
        url = `${basePath}/app/dashboards#/create?show-query-input=true&show-time-filter=true`;
      } 
      else if (objectType === 'applicationTransaction') {
        const results = await getDashboardsByTenantId({ tenantId });
        const possibleApplicationTransactionDashboards = results.map(
          (dashboard: { dashboardId: any }) => `dashboard:${dashboard.dashboardId}`
        );
        if (!results.length || !possibleApplicationTransactionDashboards.length) {
          return res.badRequest({
            body: {
              message: 'Application transaction dashboard not found.',
            },
          });
        }
        let response = await callESApi({
          path: `/.kibana/_search`,
          method: 'GET',
          data: {
            query: {
              bool: {
                must: [
                  {
                    term: {
                      type: 'dashboard',
                    },
                  },
                  {
                    terms: {
                      _id: possibleApplicationTransactionDashboards,
                    },
                  },
                  {
                    script: {
                      script: {
                        source: "doc['_id'].value.startsWith(params.prefix)",
                        params: {
                          prefix: `dashboard:${tenantId}`,
                        },
                      },
                    },
                  },
                ],
              },
            },
          },
        });
        response = response?.data?.hits.hits || [];
        if (!response.length) {
          return res.badRequest({
            body: {
              message: 'Application transaction dashboard not found.',
            },
          });
        }
        const targetDashboardId = response[0]._id.split(':')[1];
        if (!targetDashboardId) {
          return res.badRequest({
            body: {
              message: 'Application transaction dashboard not found.',
            },
          });
        }
        url = `${basePath}/app/dashboards#/view/${targetDashboardId}?embed=true&show-query-input=true&show-time-filter=true${timeFilter
          ? `&_g=(filters:!(),refreshInterval:(pause:!t,value:0),time:(${timeFilter}))`
          : ''
          }`;
      } 
      else if (objectType === 'discover') {
        url = `${basePath}/app/data-explorer/discover#?${AQ_CAN_EDIT_ROLES.includes(currentUser.role) ? '' : 'embed=true&'
          }_a=(discover:(columns:!(_source),isDirty:!f,sort:!()),metadata:(indexPattern:'${indexPatternId}',view:discover))&_q=(filters:!(),query:(language:kuery,query:''))&_g=(filters:!(),refreshInterval:(pause:!t,value:0),time:(from:now-15m,to:now))&show-time-filter=true&show-query-input=true`
      }
      else {
        return res.badRequest({
          body: {
            message: 'Invalid Object Type',
          },
        });
      }

      return res.redirected({
        headers: {
          location: url,
          'set-cookie': [
            `accessToken=${accessToken}; SameSite=Lax; Path=/aq-dashboard; Max-Age=7200`,
            `tenantId=${tenantId}; SameSite=Lax; Path=/aq-dashboard; Max-Age=7200`,
            `idToken=${idToken}; SameSite=Lax; Path=/aq-dashboard; Max-Age=7200`,
            `email=${currentUser.email}; SameSite=Lax; Path=/aq-dashboard; Max-Age=7200`,
            `unfilteredTenantId=${unfilteredTenantId}; SameSite=Lax; Path=/aq-dashboard; Max-Age=7200`,
            `role=${currentUser.role}; SameSite=Lax; Path=/aq-dashboard; Max-Age=7200`,
          ],
        },
      });
    }
  );
}


