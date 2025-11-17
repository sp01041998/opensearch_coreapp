import './index.scss';

import { OpensearchCoreappPlugin } from './plugin';

// This exports static code and TypeScript types,
// as well as, OpenSearch Dashboards Platform `plugin()` initializer.
export function plugin() {
  return new OpensearchCoreappPlugin();
}
export { OpensearchCoreappPluginSetup, OpensearchCoreappPluginStart } from './types';
