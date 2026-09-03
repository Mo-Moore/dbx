import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const tabBarSource = readFileSync(new URL("../AppTabBar.vue", import.meta.url), "utf8");

function sourceBetween(start: string, end: string): string {
  const startIndex = tabBarSource.indexOf(start);
  const endIndex = tabBarSource.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return tabBarSource.slice(startIndex, endIndex);
}

describe("AppTabBar close confirmation layout", () => {
  it("allows long unbroken tab titles to shrink and wrap inside the dialog", () => {
    expect(tabBarSource).toMatch(/<DialogContent class="[^"]*\bmin-w-0\b[^"]*\bsm:max-w-md\b/);
    expect(tabBarSource).toMatch(/<div class="[^"]*\bmin-w-0\b[^"]*\bspace-y-2\b">\s*<p class="[^"]*\bwrap-anywhere\b/);
  });

  it("keeps all single and bulk close actions while allowing the footer to wrap", () => {
    expect(tabBarSource).toMatch(/<DialogFooter class="[^"]*\bmin-w-0\b[^"]*\bsm:flex-wrap\b">/);
    expect(tabBarSource).toContain('v-if="showCloseConfirmBulkActions" variant="secondary" class="border-border" @click="handleDiscardAllAndClose"');
    expect(tabBarSource).toContain('v-if="showCloseConfirmBulkActions" @click="handleSaveAllAndClose"');
    expect(tabBarSource).toContain('variant="secondary" class="border-border" @click="handleDiscardAndClose"');
    expect(tabBarSource).toContain('@click="handleSaveAndClose"');
    expect(tabBarSource).toContain('@click="handleCancelClose"');
  });
});

describe("AppTabBar HBase presentation", () => {
  it("uses the table icon in regular, pinned, and overflow tab surfaces", () => {
    expect(tabBarSource).toContain('if (tab.mode === "data" || tab.mode === "mongo" || tab.mode === "redis" || tab.mode === "hbase") return Table2;');
    expect(tabBarSource.match(/tab\.mode === 'hbase'/g)).toHaveLength(4);
    expect(tabBarSource).toContain('tab.mode === "hbase" || tab.mode === "structure"');
  });
});

describe("AppTabBar object browser presentation", () => {
  it("uses matching icons and colors for object and database browser tabs", () => {
    expect(tabBarSource).toContain('if (tab.mode === "databases" || tab.mode === "objects") return "text-amber-500 dark:text-amber-400";');
    expect(tabBarSource).toContain('if (tab.mode === "databases") return Database;');
    expect(tabBarSource).toContain('if (tab.mode === "objects") return TableProperties;');
    expect(tabBarSource.match(/tab\.mode === 'databases'/g)).toHaveLength(4);
    expect(tabBarSource.match(/:class="tabIconClass\(tab\)"/g)).toHaveLength(4);
    expect(tabBarSource.match(/tabMenuIcon\(tab\).*tabIconClass\(tab\)/g)).toHaveLength(2);
  });
});

describe("AppTabBar locate-in-sidebar action", () => {
  it("emits the exact right-clicked tab only when it has a sidebar target", () => {
    const menu = sourceBetween("function getTabMenuItems", "function handleSaveAndClose");

    expect(tabBarSource).toContain('"locate-tab": [tab: QueryTab];');
    expect(menu).toMatch(/label: t\("sidebar\.locateActiveTab"\),\s*action: \(\) => emit\("locate-tab", tab\),\s*icon: Crosshair,\s*visible: !!activeTabSidebarTarget\(tab\)/);
    expect(menu).not.toContain("activateTab(tab.id)");
  });

  it("leaves settings, driver, and existing regular-tab menu actions unchanged", () => {
    const specialMenu = sourceBetween("function getSpecialRegularTabMenuItems", "function getTabMenuItems");
    const regularMenu = sourceBetween("function getTabMenuItems", "function handleSaveAndClose");

    expect(specialMenu).not.toContain('t("sidebar.locateActiveTab")');
    expect(regularMenu).toContain('label: t("contextMenu.copyName")');
    expect(regularMenu).toContain("action: () => queryStore.togglePinnedTab(tab.id)");
    expect(regularMenu).toContain("action: () => queryStore.closeTab(tab.id)");
  });
});

describe("AppTabBar Zen mode interaction", () => {
  it("switches Zen mode for data tabs while preserving query-tab renaming", () => {
    const handler = sourceBetween("function handleTabDoubleClick", "function handleTabMouseDown");

    expect(tabBarSource).toContain('"toggle-zen-mode": [];');
    expect(handler).toContain('if (tab.mode === "data") {');
    expect(handler).toContain('emit("toggle-zen-mode");');
    expect(handler).toContain("startRenameTab(tab);");
    expect(handler).toContain("event.target instanceof Element && event.target.closest(\"button, input, [role='button']\")");
    expect(tabBarSource.match(/@dblclick="handleTabDoubleClick\(tab, \$event\)"/g)).toHaveLength(4);
  });
});

describe("AppTabBar right-side close action", () => {
  it("places the action after close-other and disables it when the target has no tabs to its right", () => {
    expect(tabBarSource).toContain('label: t("contextMenu.closeRightTabs")');
    expect(tabBarSource).toContain("action: () => closeTabsToRightFromTab(tab)");
    expect(tabBarSource).toContain("disabled: !hasTabsToRight(tab)");

    const closeOtherPositions = [...tabBarSource.matchAll(/label: closeOtherLabel,/g)].map((match) => match.index);
    const closeRightPositions = [...tabBarSource.matchAll(/label: t\("contextMenu\.closeRightTabs"\),/g)].map((match) => match.index);
    const closeAllPositions = [...tabBarSource.matchAll(/label: closeAllLabel,/g)].map((match) => match.index);
    expect(closeOtherPositions).toHaveLength(2);
    expect(closeRightPositions).toHaveLength(2);
    expect(closeAllPositions).toHaveLength(2);
    closeRightPositions.forEach((position, index) => {
      expect(position).toBeGreaterThan(closeOtherPositions[index]);
      expect(position).toBeLessThan(closeAllPositions[index]);
    });
  });

  it("waits for query tab confirmation before closing special surfaces", () => {
    expect(tabBarSource).toMatch(/queryStore\.closeTabsByIds\(tabsToClose, finalActiveTabId, \(\) => \{[\s\S]*closeSpecialRegularSurfaces\(\);/);
    expect(tabBarSource).toContain("if (shouldActivateTarget) activateTab(tab.id)");
  });

  it("reactivates settings after closing an active driver store to its right", () => {
    expect(tabBarSource).toContain("const shouldActivateSettings = !!props.driverStoreActive");
    expect(tabBarSource).toMatch(/emit\("close-driver-store"\);\s*if \(shouldActivateSettings\) emit\("activate-settings-page"\);/);
  });
});

describe("AppTabBar left-side close action", () => {
  it("places the action after close-other, before close-right, and disables it when the target has no tabs to its left", () => {
    expect(tabBarSource).toContain('label: t("contextMenu.closeLeftTabs")');
    expect(tabBarSource).toContain("action: () => closeTabsToLeftFromTab(tab)");
    expect(tabBarSource).toContain("disabled: !hasTabsToLeft(tab)");

    const closeOtherPositions = [...tabBarSource.matchAll(/label: closeOtherLabel,/g)].map((match) => match.index);
    const closeLeftPositions = [...tabBarSource.matchAll(/label: t\("contextMenu\.closeLeftTabs"\),/g)].map((match) => match.index);
    const closeRightPositions = [...tabBarSource.matchAll(/label: t\("contextMenu\.closeRightTabs"\),/g)].map((match) => match.index);
    expect(closeOtherPositions).toHaveLength(2);
    // The special-surface menu has no left-side action: settings and the
    // driver store sit at the rightmost end of the tab bar, so nothing can be
    // to the left of them. Only the regular/pinned tab menu gets the item.
    expect(closeLeftPositions).toHaveLength(1);
    expect(closeRightPositions).toHaveLength(2);
    const closeLeftPosition = closeLeftPositions[0];
    expect(closeLeftPosition).toBeGreaterThan(closeOtherPositions[1]);
    expect(closeLeftPosition).toBeLessThan(closeRightPositions[1]);
  });
});

describe("AppTabBar special page selection", () => {
  it("shows the active settings or driver-manager tab with the same ring used by regular tabs", () => {
    expect(tabBarSource).toContain("function specialTabActiveStyle(active: boolean | undefined)");
    expect(tabBarSource).toContain('return isClassicLayout.value ? { boxShadow: "inset 0 -2px 0 var(--ring)" } : { borderColor: "var(--ring)" };');
    expect(tabBarSource).toContain(':style="specialTabActiveStyle(settingsPageActive)"');
    expect(tabBarSource).toContain(':style="specialTabActiveStyle(driverStoreActive)"');
  });
});

describe("AppTabBar overflow search", () => {
  it("filters every open tab by its display and source titles", () => {
    expect(tabBarSource).toContain('const tabSearchQuery = ref("");');
    expect(tabBarSource).toContain("const filteredOpenTabs = computed(() => {");
    expect(tabBarSource).toContain("return displayedTabs.value.filter((tab) => tabMatchesSearch(tab, query));");
    expect(tabBarSource).toContain("return tabTitleText(tab).toLocaleLowerCase().includes(query) || tab.title.toLocaleLowerCase().includes(query) || connectionName.toLocaleLowerCase().includes(query);");
  });

  it("provides the same focused search control and empty state in both overflow menus", () => {
    expect(tabBarSource.match(/<Input data-tab-search-input=/g)).toHaveLength(2);
    expect(tabBarSource.match(/v-for="tab in filteredOpenTabs"/g)).toHaveLength(2);
    expect(tabBarSource.match(/tabs\.noMatchingTabs/g)).toHaveLength(2);
    expect(tabBarSource).toContain('[data-tab-search-input="regular"]');
    expect(tabBarSource).toContain('[data-tab-search-input="fixed"]');
  });
});

describe("AppTabBar query execution status", () => {
  it("replaces the icon through one shared status component in every tab surface", () => {
    expect(tabBarSource).toContain('import TabExecutionStatus from "@/components/layout/TabExecutionStatus.vue";');
    expect(tabBarSource.match(/<TabExecutionStatus :tab="tab">/g)).toHaveLength(6);
    expect(tabBarSource.match(/<\/TabExecutionStatus>/g)).toHaveLength(6);
  });
});

describe("AppTabBar grouping presentation", () => {
  it("renders collapsible group headers with database icons and without uppercase styling", () => {
    expect(tabBarSource).toContain('const isGroupingEnabled = computed(() => settingsStore.editorSettings.tabGroupMode !== "none")');
    expect(tabBarSource).toContain("function tabGroupIconType(tab: QueryTab)");
    expect(tabBarSource).toContain("function toggleTabGroupCollapse(surface: TabGroupSurface, key: string)");
    expect(tabBarSource).toContain("function isGroupTabsVisible(surface: TabGroupSurface, key: string)");
    expect(tabBarSource.match(/<DatabaseIcon :db-type="group\.iconType" class="h-3\.5 w-3\.5 shrink-0" \/>/g)).toHaveLength(2);
    expect(tabBarSource).toMatch(/<ChevronRight v-if="isTabGroupCollapsed\('regular', group\.key\)"/);
    expect(tabBarSource).toMatch(/<ChevronRight v-if="isTabGroupCollapsed\('fixed', group\.key\)"/);
    expect(tabBarSource).toMatch(/<ChevronDown v-else class="h-3\.5 w-3\.5 shrink-0" \/>/);
    expect(tabBarSource).not.toContain("text-transform: uppercase");
    expect(tabBarSource).toContain("v-if=\"isGroupTabsVisible('regular', group.key)\"");
    expect(tabBarSource).toContain("v-if=\"isGroupTabsVisible('fixed', group.key)\"");
  });

  it("keeps regular and fixed group collapse state independent", () => {
    expect(tabBarSource).toContain('type TabGroupSurface = "regular" | "fixed"');
    expect(tabBarSource).toContain("function tabGroupCollapseKey(surface: TabGroupSurface, key: string)");
    expect(tabBarSource).toContain("return `${surface}:${key}`");
    expect(tabBarSource).toContain("@click=\"toggleTabGroupCollapse('regular', group.key)\"");
    expect(tabBarSource).toContain("@click=\"toggleTabGroupCollapse('fixed', group.key)\"");
    expect(tabBarSource).not.toContain("toggleTabGroupCollapse(group.key)");
    expect(tabBarSource).not.toContain("isTabGroupCollapsed(group.key)");
    expect(tabBarSource).not.toContain("isGroupTabsVisible(group.key)");
  });

  it("uses inline single-row headers for top/bottom and stacked headers for left/right", () => {
    expect(tabBarSource).not.toContain("tab-group-columns");
    expect(tabBarSource).toContain("function buildTabGroupSections(tabs: QueryTab[])");
    expect(tabBarSource).toContain("tab-group-section--inline");
    expect(tabBarSource).toContain("tab-group-section--vertical");
    expect(tabBarSource).toContain("function isGroupTabsVisible(surface: TabGroupSurface, key: string)");
    expect(tabBarSource).toMatch(/if \(tabSearchQuery\.value\.trim\(\)\) return true;/);
    expect(tabBarSource).toContain('v-if="isGroupingEnabled"');
  });

  it("aligns horizontal group headers with tab pills and separates groups", () => {
    expect(tabBarSource).toContain("app-tab-bar--classic-horizontal");
    expect(tabBarSource).toContain(".tab-group-section--inline:not(:first-child)");
    expect(tabBarSource).toContain(".tab-group-section--inline .tab-group-header");
  });

  it("matches the sidebar search header height and white input styling in vertical layout", () => {
    expect(tabBarSource).toContain('class="connection-tree-search relative z-10 shrink-0 flex items-center border-b px-2"');
    expect(tabBarSource).toContain(":class=\"isClassicLayout ? 'h-9' : 'h-10'\"");
    expect(tabBarSource).toContain("border border-border bg-background pl-7");
    expect(tabBarSource).toContain("outline-none focus:border-ring");
    expect(tabBarSource).not.toContain("focus:ring-inset");
    expect(tabBarSource).toContain(".vertical-tab-layout > .connection-tree-search");
  });

  it("keeps tab titles and group headers in neutral foreground colors", () => {
    expect(tabBarSource).not.toContain("function tabGroupHeaderStyle(tab: QueryTab)");
    expect(tabBarSource).not.toContain("function isTabActive(tab: QueryTab)");
    expect(tabBarSource).not.toContain("headerStyle:");
    expect(tabBarSource).not.toMatch(/styles\.color = isTabActive\(tab\) \? color : hexToRgba\(color, 0\.82\)/);
    expect(tabBarSource).toContain("if (!isDirtyTab(tab)) return undefined;");
    expect(tabBarSource).toContain("color: var(--muted-foreground)");
  });

  it("stretches horizontal group headers to match tab row height", () => {
    expect(tabBarSource).toContain("align-self: stretch");
    expect(tabBarSource).not.toMatch(/\.tab-group-section--inline \.tab-group-header\s*\{[^}]*align-self:\s*center/);
    expect(tabBarSource).toContain(".app-tab-scroll.classic-wrap .tab-group-header");
  });

  it("keeps vertical tab lists scrollable when they exceed the available height", () => {
    expect(tabBarSource).toContain("function tabItemWrapperClass()");
    expect(tabBarSource).toContain("vertical-tab-row vertical-tab-row--regular");
    expect(tabBarSource).toContain("vertical-tab-row vertical-tab-row--fixed");
    expect(tabBarSource).toContain("vertical-tab-scroller min-h-0 flex-1 overflow-y-auto overflow-x-hidden pt-0.5 pb-1");
    expect(tabBarSource).toContain(".vertical-tab-layout .vertical-tab-row--regular");
    expect(tabBarSource).toContain(".vertical-tab-layout .vertical-tab-row--fixed");
    expect(tabBarSource).toContain("max-height: 40%");
    expect(tabBarSource).toContain("vertical-tab-scrollbar");
    expect(tabBarSource).toContain(".vertical-tab-layout .vertical-tab-scroller::-webkit-scrollbar");
    expect(tabBarSource).toContain(".tab-group-section--vertical");
  });

  it("uses native vertical scrolling and updates the custom scrollbar outside Vue render path", () => {
    expect(tabBarSource).not.toContain("function onVerticalTabsWheel(");
    expect(tabBarSource).toContain("if (!isVerticalLayout.value) onTabsWheel(event)");
    expect(tabBarSource).toContain("if (!isVerticalLayout.value) onFixedTabsWheel(event)");
    expect(tabBarSource).toContain("function scheduleVerticalScrollMetricsUpdate(");
    expect(tabBarSource).toContain("verticalScrollMetricsAnimationFrame = window.requestAnimationFrame");
    expect(tabBarSource).toContain("function applyVerticalScrollbarThumbStyle(area: VerticalTabScrollArea)");
    expect(tabBarSource).toContain("thumb.style.transform = `translateY(${thumbTop}px)`");
    expect(tabBarSource).toContain('ref="regularVerticalScrollbarThumbRef"');
    expect(tabBarSource).toContain('ref="fixedVerticalScrollbarThumbRef"');
    expect(tabBarSource).not.toContain("regularVerticalScrollbarThumbStyle");
    expect(tabBarSource).not.toContain("fixedVerticalScrollbarThumbStyle");
    expect(tabBarSource).toContain("scheduleVerticalScrollMetricsUpdate([area])");
  });

  it("creates the vertical ResizeObserver during setup so observe is not order-dependent", () => {
    expect(tabBarSource).toContain('typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => scheduleVerticalScrollMetricsUpdate())');
    expect(tabBarSource).not.toContain('onMounted(() => {\n  if (typeof ResizeObserver === "undefined") return;');
    expect(tabBarSource).not.toContain("verticalTabScrollbarResizeObserver = new ResizeObserver");
  });

  it("renews vertical scroll activity on scrollbar drag stop so tooltips are not stuck disabled", () => {
    expect(tabBarSource).toContain('import { createVerticalScrollActivity } from "@/composables/verticalScrollActivity";');
    expect(tabBarSource).toContain("const regularVerticalScrollActivity = createVerticalScrollActivity()");
    expect(tabBarSource).toContain("const fixedVerticalScrollActivity = createVerticalScrollActivity()");
    expect(tabBarSource).toContain("function markVerticalScrolling(area: VerticalTabScrollArea)");
    expect(tabBarSource).toContain('markVerticalScrolling("regular")');
    expect(tabBarSource).toContain('markVerticalScrolling("fixed")');
    expect(tabBarSource).toContain("function stopRegularVerticalScrollbarDrag()");
    expect(tabBarSource).toContain("function stopFixedVerticalScrollbarDrag()");
    expect(tabBarSource).toMatch(/function stopRegularVerticalScrollbarDrag\(\) \{[\s\S]*?if \(wasDragging\) markVerticalScrolling\("regular"\)/);
    expect(tabBarSource).toMatch(/function stopFixedVerticalScrollbarDrag\(\) \{[\s\S]*?if \(wasDragging\) markVerticalScrolling\("fixed"\)/);
    expect(tabBarSource).not.toContain("isRegularVerticalScrolling.value = true");
    expect(tabBarSource).not.toContain("isFixedVerticalScrolling.value = true");
  });

  it("refreshes vertical scrollbar metrics when group collapse or search changes content height", () => {
    expect(tabBarSource).toContain("collapsedTabGroupKeys,");
    expect(tabBarSource).toContain("tabSearchQuery,");
    expect(tabBarSource).toMatch(/collapsedTabGroupKeys,\s*\n\s*tabSearchQuery,/);
  });

  it("wraps grouped tabs in a shared horizontal flex flow when grouping is enabled", () => {
    expect(tabBarSource).toContain("const isHorizontalTabWrap = computed(() => !isVerticalLayout.value && (isWrapLayout.value || isGroupingEnabled.value))");
    expect(tabBarSource).toContain("isHorizontalTabWrap ? 'wrap-mode' : ''");
    expect(tabBarSource).toContain(".app-tab-scroll.wrap-mode .tab-group-section--inline {");
    expect(tabBarSource).toContain("display: contents;");
    expect(tabBarSource).toContain(".app-tab-scroll.wrap-mode .tab-group-header:not(:first-of-type)");
    expect(tabBarSource).not.toMatch(/\.app-tab-scroll\.wrap-mode \.tab-group-section--inline\s*\{[^}]*flex-wrap:\s*nowrap/);
    expect(tabBarSource).toContain("!isHorizontalTabWrap.value && !isVerticalLayout.value");
  });

  it("lets horizontal wrap tab bars grow naturally without vertical scrolling", () => {
    expect(tabBarSource).toContain(".app-tab-bar:has(.wrap-mode):not(.vertical-tab-layout)");
    expect(tabBarSource).toContain("overflow: visible !important;");
    expect(tabBarSource).not.toContain("max-height: min(40vh, 14rem)");
    expect(tabBarSource).not.toMatch(/\.app-tab-bar:has\(\.wrap-mode\):not\(\.vertical-tab-layout\)\s*\{[^}]*overflow-y:\s*auto/);
  });
});

describe("AppTabBar tab tooltip presentation", () => {
  const tabBarTooltipSource = readFileSync(new URL("../TabBarTooltip.vue", import.meta.url), "utf8");

  it("uses TabBarTooltip instead of the dark shadcn tooltip for tab hovers", () => {
    expect(tabBarSource).toContain('import TabBarTooltip from "@/components/layout/TabBarTooltip.vue";');
    expect(tabBarSource).not.toContain("@/components/ui/tooltip");
    expect(tabBarSource.match(/<TabBarTooltip :tab="tab"/g)).toHaveLength(4);
    expect(tabBarSource).not.toContain("<TooltipContent");
    expect(tabBarSource).not.toContain("tabTooltipLines");
  });

  it("suppresses tab tooltips while vertical tab lists are scrolling or scrollbar dragging", () => {
    expect(tabBarSource).toContain("const tabTooltipDelay = computed(() => (isVerticalLayout.value ? 500 : 300))");
    expect(tabBarSource).toContain("const suppressRegularTabTooltip = computed(() => isRegularVerticalScrolling.value || isDraggingRegularVerticalScrollbar.value)");
    expect(tabBarSource).toContain("const suppressFixedTabTooltip = computed(() => isFixedVerticalScrolling.value || isDraggingFixedVerticalScrollbar.value)");
    expect(tabBarSource.match(/:disabled="suppressRegularTabTooltip"/g)).toHaveLength(2);
    expect(tabBarSource.match(/:disabled="suppressFixedTabTooltip"/g)).toHaveLength(2);
    expect(tabBarSource.match(/:delay="tabTooltipDelay"/g)).toHaveLength(4);
    expect(tabBarSource).not.toContain(':disabled="isRegularVerticalScrolling"');
    expect(tabBarSource).not.toContain(':disabled="isFixedVerticalScrolling"');
    expect(tabBarTooltipSource).toContain("disabled?: boolean");
    expect(tabBarTooltipSource).toContain("delay?: number");
    expect(tabBarTooltipSource).toContain(':disabled="disabled"');
    expect(tabBarTooltipSource).toContain(':delay="delay"');
  });

  it("opens tab tooltips toward the content area based on tab bar placement", () => {
    expect(tabBarSource).toContain("const tabTooltipSide = computed(() => {");
    expect(tabBarSource).toContain('case "left":');
    expect(tabBarSource).toContain('return "right"');
    expect(tabBarSource).toContain('case "right":');
    expect(tabBarSource).toContain('return "left"');
    expect(tabBarSource).toContain('case "bottom":');
    expect(tabBarSource).toContain('return "top"');
    expect(tabBarSource).toContain('return "bottom"');
    expect(tabBarSource.match(/:side="tabTooltipSide"/g)).toHaveLength(4);
    expect(tabBarTooltipSource).toContain('side?: "top" | "right" | "bottom" | "left"');
    expect(tabBarTooltipSource).toContain('side: "bottom"');
    expect(tabBarTooltipSource).toContain(':side="side"');
  });

  it("renders tab tooltip rows in the connection-tree popover style", () => {
    expect(tabBarTooltipSource).toContain('import LightTooltip from "@/components/ui/LightTooltip.vue";');
    expect(tabBarTooltipSource).toContain('surface="popover"');
    expect(tabBarTooltipSource).toContain("tabTooltipLines(props.tab, t)");
    expect(tabBarTooltipSource).toContain("border border-border bg-popover");
    expect(tabBarTooltipSource).toContain("grid-cols-[max-content_minmax(0,1fr)]");
  });
});
