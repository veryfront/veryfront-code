export interface Tab {
    id: string;
    label: string;
    shortcut?: string;
}
export interface TabBarOptions {
    tabs: Tab[];
    activeTabId: string;
}
export declare function renderTabBar(options: TabBarOptions): string;
export declare const MAIN_TABS: Tab[];
export declare function getTabIndex(tabId: string): number;
export declare function getTabById(tabId: string): Tab | undefined;
export declare function getNextTab(currentTabId: string): string;
export declare function getPrevTab(currentTabId: string): string;
//# sourceMappingURL=tab-bar.d.ts.map