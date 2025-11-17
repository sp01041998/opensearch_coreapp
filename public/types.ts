import { NavigationPublicPluginStart } from '../../../src/plugins/navigation/public';

export interface OpensearchCoreappPluginSetup {
  getGreeting: () => string;
}
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface OpensearchCoreappPluginStart {}

export interface AppPluginStartDependencies {
  navigation: NavigationPublicPluginStart;
}
