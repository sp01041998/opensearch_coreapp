import { CoreSetup, CoreStart, Plugin } from 'opensearch-dashboards/server';
import { registerRootRedirectRoute } from './routes/root_redirect';
// import { registerFieldsForWildcardRoute } from './routes/fields_for_wildcard';
import { registerProxySavedObjectsRoute } from './routes/proxy_saved_objects';
// import { registerNotificationsRoutes } from './routes/notifications';

export class OpensearchCoreappPlugin implements Plugin {
  setup(core, plugins) {
    core.http.registerRouteHandlerContext(
      'coreapp',
      async (context, req, res) => ({
        http: core.http,
        basePath: core.http.basePath,
      })
    );

    const router = core.http.createRouter();
    registerProxySavedObjectsRoute(router);
  }

  start() {}
  stop() {}
}

