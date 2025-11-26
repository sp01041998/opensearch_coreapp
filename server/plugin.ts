import { Plugin } from 'opensearch-dashboards/server';
import { createCoreAppSOWrapper } from './saved_objects/so_wrapper';
import { registerProxySavedObjectsRoute } from './routes/proxy_saved_objects';
// import { registerRootRedirectRoute } from './routes/root_redirect';
// import { createWrappedSearchStrategy } from './saved_objects/search_strategy_wrapper';
import { awsTenantSearchStrategy } from './saved_objects/search_strategy_wrapper';

export class OpensearchCoreappPlugin implements Plugin {
  setup(core, plugins) {
    core.http.registerRouteHandlerContext(
      'coreapp',
      async (context, req, res) => ({
        http: core.http,
        basePath: core.http.basePath,
      })
    );

      if (!plugins.data) {
      throw new Error("Data plugin is required");
    }

    const search = plugins.data.search;
    search.registerSearchStrategy("awsTenantSearch", awsTenantSearchStrategy);


    core.savedObjects.addClientWrapper(
      Number.MAX_SAFE_INTEGER,
      'coreappAuth',
      createCoreAppSOWrapper
    );

    const router = core.http.createRouter();
    registerProxySavedObjectsRoute(router);
    // registerRootRedirectRoute(core);
  }

  start() { }
  // stop() {}
}


