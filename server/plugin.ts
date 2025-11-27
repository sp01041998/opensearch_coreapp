import { Plugin } from 'opensearch-dashboards/server';
import { createCoreAppSOWrapper } from './saved_objects/so_wrapper';
import { registerProxySavedObjectsRoute } from './routes/proxy_saved_objects';

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


