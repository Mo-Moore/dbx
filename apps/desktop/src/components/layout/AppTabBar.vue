<script setup lang="ts">
import { computed, ref, watch, nextTick, onUnmounted } from "vue";
import type { CSSProperties } from "vue";
import { useI18n } from "vue-i18n";
import { X, Pin, ChevronDown, ChevronRight, Search, Table2, Code2, TableProperties, PencilRuler, KeyRound, Pencil, Package, Copy, AlertTriangle, Network, Minimize2, Maximize2, Settings, CalendarClock, Activity, Gauge, ShieldCheck, Database, GitBranch, Crosshair } from "@lucide/vue";
import CustomContextMenu, { type ContextMenuItem } from "@/components/ui/CustomContextMenu.vue";
import TabBarTooltip from "@/components/layout/TabBarTooltip.vue";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import DatabaseIcon from "@/components/icons/DatabaseIcon.vue";
import TabExecutionStatus from "@/components/layout/TabExecutionStatus.vue";
import { useConnectionStore } from "@/stores/connectionStore";
import { useQueryStore } from "@/stores/queryStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTabScroll } from "@/composables/useTabScroll";
import { useTabDrag } from "@/composables/useTabDrag";
import { createVerticalScrollActivity } from "@/composables/verticalScrollActivity";
import { connectionColor, tabDisplayTitle } from "@/lib/tabs/tabPresentation";
import ReadOnlySessionControl from "@/components/connection/ReadOnlySessionControl.vue";
import { hexToRgba } from "@/lib/common/color";
import { copyToClipboard } from "@/lib/common/clipboard";
import { useToast } from "@/composables/useToast";
import { activeTabSidebarTarget } from "@/lib/sidebar/sidebarActiveTabTarget";
import type { QueryTab } from "@/types/database";

const props = defineProps<{
  driverStoreOpen?: boolean;
  driverStoreActive?: boolean;
  settingsPageOpen?: boolean;
  settingsPageActive?: boolean;
  agentDriverUpdateCount?: number;
  detachedDropTarget?: boolean;
  canDetachTabs?: boolean;
}>();

const emit = defineEmits<{
  "activate-tab": [];
  "toggle-zen-mode": [];
  "locate-tab": [tab: QueryTab];
  "activate-driver-store": [];
  "close-driver-store": [];
  "activate-settings-page": [];
  "close-settings-page": [];
  "save-tab": [tabId: string];
  "discard-tab-close": [];
  "save-all-tab-close": [];
  "discard-all-tab-close": [];
  "cancel-tab-close": [];
  "detach-tab": [tab: QueryTab, position?: { x: number; y: number }];
}>();

const { t } = useI18n();
const connectionStore = useConnectionStore();
const queryStore = useQueryStore();
const settingsStore = useSettingsStore();
const { toast } = useToast();
const tabDrag = useTabDrag(
  (draggedId, targetId, position) => {
    return queryStore.reorderTab(draggedId, targetId, position);
  },
  (draggedId, position) => {
    if (!props.canDetachTabs) return false;
    const tab = queryStore.tabs.find((item) => item.id === draggedId);
    if (!tab || !isDetachableTab(tab)) return false;
    emit("detach-tab", tab, position);
    return true;
  },
  () => (isVerticalLayout.value ? "vertical" : "horizontal"),
);
const editingTabId = ref<string | null>(null);
const editingTitle = ref("");
const isClassicLayout = computed(() => settingsStore.editorSettings.appLayout === "classic");
const isVerticalLayout = computed(() => settingsStore.editorSettings.tabPlacement === "left" || settingsStore.editorSettings.tabPlacement === "right");
const isWrapLayout = computed(() => !isVerticalLayout.value && settingsStore.editorSettings.tabLayout === "wrap");
const isManualTabOrder = computed(() => settingsStore.editorSettings.tabSortMode === "manual");
const isGroupingEnabled = computed(() => settingsStore.editorSettings.tabGroupMode !== "none");
const isHorizontalTabWrap = computed(() => !isVerticalLayout.value && (isWrapLayout.value || isGroupingEnabled.value));

function tabGroupKey(tab: QueryTab) {
  const connection = connectionStore.getConfig(tab.connectionId);
  if (settingsStore.editorSettings.tabGroupMode === "connection") return tab.connectionId;
  return connection?.driver_profile || connection?.db_type || tab.connectionId || "unknown";
}

function sortDisplayedTabs(tabs: QueryTab[]) {
  const sortMode = settingsStore.editorSettings.tabSortMode;
  const groupMode = settingsStore.editorSettings.tabGroupMode;
  return tabs
    .map((tab, index) => ({ tab, index }))
    .sort((left, right) => {
      if (groupMode !== "none") {
        const group = tabGroupKey(left.tab).localeCompare(tabGroupKey(right.tab), undefined, { sensitivity: "base", numeric: true });
        if (group) return group;
      }
      if (sortMode === "manual") return left.index - right.index;
      if (sortMode === "created-asc") {
        const created = (left.tab.createdAt ?? left.index) - (right.tab.createdAt ?? right.index);
        if (created) return created;
      } else {
        const title = tabTitleText(left.tab).localeCompare(tabTitleText(right.tab), undefined, { sensitivity: "base", numeric: true });
        if (title) return title;
      }
      return left.index - right.index;
    })
    .map(({ tab }) => tab);
}

const fixedTabs = computed(() => sortDisplayedTabs(queryStore.tabs.filter((tab) => tab.pinned)));
const regularTabs = computed(() => sortDisplayedTabs(queryStore.tabs.filter((tab) => !tab.pinned)));
const displayedTabs = computed(() => [...fixedTabs.value, ...regularTabs.value]);

function tabGroupLabel(tab: QueryTab) {
  const connection = connectionStore.getConfig(tab.connectionId);
  if (settingsStore.editorSettings.tabGroupMode === "connection") return connection?.name || tab.connectionId;
  return connection?.driver_label || connection?.driver_profile || connection?.db_type || tab.connectionId;
}

type TabGroupSurface = "regular" | "fixed";

const collapsedTabGroupKeys = ref(new Set<string>());

function tabGroupCollapseKey(surface: TabGroupSurface, key: string) {
  return `${surface}:${key}`;
}

function isTabGroupCollapsed(surface: TabGroupSurface, key: string) {
  return collapsedTabGroupKeys.value.has(tabGroupCollapseKey(surface, key));
}

function toggleTabGroupCollapse(surface: TabGroupSurface, key: string) {
  const storageKey = tabGroupCollapseKey(surface, key);
  const next = new Set(collapsedTabGroupKeys.value);
  if (next.has(storageKey)) next.delete(storageKey);
  else next.add(storageKey);
  collapsedTabGroupKeys.value = next;
}

function isGroupTabsVisible(surface: TabGroupSurface, key: string) {
  if (!isGroupingEnabled.value) return true;
  if (tabSearchQuery.value.trim()) return true;
  return !collapsedTabGroupKeys.value.has(tabGroupCollapseKey(surface, key));
}

type TabGroupSection = {
  key: string;
  label: string;
  iconType: string;
  tabs: QueryTab[];
};

function buildTabGroupSections(tabs: QueryTab[]): TabGroupSection[] {
  const sections: TabGroupSection[] = [];
  for (const tab of tabs) {
    const key = tabGroupKey(tab);
    const last = sections[sections.length - 1];
    if (last?.key === key) last.tabs.push(tab);
    else {
      sections.push({
        key,
        label: tabGroupLabel(tab),
        iconType: tabGroupIconType(tab),
        tabs: [tab],
      });
    }
  }
  return sections;
}

function tabGroupIconType(tab: QueryTab) {
  const connection = connectionStore.getConfig(tab.connectionId);
  if (!connection) return "postgres";
  if (connection.db_type === "mq") return tabDatabaseIconType(tab);
  return connection.driver_profile || connection.db_type || "postgres";
}

const hasFixedTabs = computed(() => fixedTabs.value.length > 0);
const regularSurfaceCount = computed(() => regularTabs.value.length + (props.driverStoreOpen ? 1 : 0) + (props.settingsPageOpen ? 1 : 0));
const closeConfirmDirtyCount = computed(() => queryStore.closeConfirmDirtyTabIds.length);
const showCloseConfirmBulkActions = computed(() => closeConfirmDirtyCount.value > 1);
const closeConfirmDirtyTabs = computed(() => queryStore.closeConfirmDirtyTabIds.map((id) => queryStore.tabs.find((tab) => tab.id === id)).filter((tab): tab is QueryTab => !!tab));
const closeConfirmCurrentTitle = computed(() => {
  const focusedTab = closeConfirmDirtyTabs.value.find((tab) => tab.id === queryStore.pendingCloseTabId) ?? closeConfirmDirtyTabs.value[0];
  return focusedTab ? tabDisplayTitle(focusedTab, t) : "";
});
const closeConfirmMessage = computed(() => {
  const params = {
    count: closeConfirmDirtyCount.value,
    title: closeConfirmCurrentTitle.value,
  };
  if (closeConfirmDirtyCount.value > 1) {
    if (queryStore.closeConfirmContext === "app") return t("editor.unsavedChangesAppCloseMultipleMessage", params);
    return t("editor.unsavedChangesBatchCloseMultipleMessage", params);
  }
  if (queryStore.closeConfirmContext === "app") return t("editor.unsavedChangesAppCloseMessage", params);
  return t("editor.unsavedChangesMessage", params);
});
const closeConfirmListOpen = ref(false);
let closeConfirmListCloseTimer: ReturnType<typeof setTimeout> | null = null;
const compactTabTitle = computed({
  get: () => settingsStore.editorSettings.compactTabTitle,
  set: (checked: boolean | "indeterminate") => {
    settingsStore.updateEditorSettings({ compactTabTitle: checked === true });
  },
});

function openCloseConfirmList() {
  if (closeConfirmListCloseTimer) {
    clearTimeout(closeConfirmListCloseTimer);
    closeConfirmListCloseTimer = null;
  }
  closeConfirmListOpen.value = true;
}

function scheduleCloseConfirmListClose() {
  if (closeConfirmListCloseTimer) clearTimeout(closeConfirmListCloseTimer);
  closeConfirmListCloseTimer = setTimeout(() => {
    closeConfirmListOpen.value = false;
    closeConfirmListCloseTimer = null;
  }, 120);
}

onUnmounted(() => {
  tabDrag.setDetachBoundsProvider(null);
  if (closeConfirmListCloseTimer) {
    clearTimeout(closeConfirmListCloseTimer);
    closeConfirmListCloseTimer = null;
  }
  stopRegularVerticalScrollbarDrag();
  stopFixedVerticalScrollbarDrag();
  regularVerticalScrollActivity.dispose();
  fixedVerticalScrollActivity.dispose();
  if (verticalScrollMetricsAnimationFrame) window.cancelAnimationFrame(verticalScrollMetricsAnimationFrame);
  verticalTabScrollbarResizeObserver?.disconnect();
});

watch(
  () => queryStore.showCloseConfirm,
  (open) => {
    if (!open) closeConfirmListOpen.value = false;
  },
);

function toggleCompactTabTitle() {
  compactTabTitle.value = !compactTabTitle.value;
}

function canRenameTab(tab: QueryTab) {
  return tab.mode === "query";
}

function isDetachableTab(tab: QueryTab) {
  return tab.mode === "query" || tab.mode === "data";
}

function startRenameTab(tab: QueryTab) {
  if (!canRenameTab(tab)) return;
  editingTabId.value = tab.id;
  editingTitle.value = tab.title;
  nextTick(() => {
    const input = document.querySelector<HTMLInputElement>(`[data-tab-title-input="${tab.id}"]`);
    if (input) {
      input.focus();
      const dotIndex = input.value.lastIndexOf(".");
      const selectEnd = dotIndex > 0 ? dotIndex : input.value.length;
      input.setSelectionRange(0, selectEnd);
    }
  });
}

function commitRenameTab(tab: QueryTab) {
  if (editingTabId.value !== tab.id) return;
  const title = editingTitle.value.trim();
  if (title) queryStore.renameTab(tab.id, title);
  editingTabId.value = null;
}

function cancelRenameTab() {
  editingTabId.value = null;
}

function isDirtyTab(tab: QueryTab) {
  return queryStore.isTabDirty(tab);
}

function tabTitleLabel(tab: QueryTab) {
  const title = tabDisplayTitle(tab, t);
  return isDirtyTab(tab) ? `* ${title}` : title;
}

function tabTitleText(tab: QueryTab) {
  return tabDisplayTitle(tab, t);
}

function tabTitleStyle(tab: QueryTab): CSSProperties | undefined {
  if (!isDirtyTab(tab)) return undefined;
  return {
    fontStyle: "italic",
    fontWeight: 700,
    transform: "skewX(-8deg)",
    transformOrigin: "left center",
  };
}

type SpecialRegularSurface = "driverStore" | "settings";

function closeSpecialRegularSurfaces(keep?: SpecialRegularSurface) {
  if (keep !== "driverStore" && props.driverStoreOpen) emit("close-driver-store");
  if (keep !== "settings" && props.settingsPageOpen) emit("close-settings-page");
}

function closeOtherRegularTabsFromTab(tab: QueryTab) {
  queryStore.closeOtherRegularTabs(tab.id);
  closeSpecialRegularSurfaces();
}

function tabsToRightInGroup(tab: QueryTab) {
  const groupedTabs = tab.pinned ? fixedTabs.value : regularTabs.value;
  const targetIndex = groupedTabs.findIndex((item) => item.id === tab.id);
  return targetIndex < 0 ? [] : groupedTabs.slice(targetIndex + 1);
}

function hasTabsToRight(tab: QueryTab) {
  return tabsToRightInGroup(tab).length > 0 || (!tab.pinned && (!!props.settingsPageOpen || !!props.driverStoreOpen));
}

function closeTabsToRightFromTab(tab: QueryTab) {
  const shouldActivateTarget = !tab.pinned && (!!props.settingsPageActive || !!props.driverStoreActive);
  const tabsToClose = tabsToRightInGroup(tab).map((item) => item.id);
  const finalActiveTabId = queryStore.activeTabId && !tabsToClose.includes(queryStore.activeTabId) ? queryStore.activeTabId : tab.id;
  queryStore.closeTabsByIds(tabsToClose, finalActiveTabId, () => {
    if (tab.pinned) return;
    closeSpecialRegularSurfaces();
    if (shouldActivateTarget) activateTab(tab.id);
  });
}

function tabsToLeftInGroup(tab: QueryTab) {
  const groupedTabs = tab.pinned ? fixedTabs.value : regularTabs.value;
  const targetIndex = groupedTabs.findIndex((item) => item.id === tab.id);
  return targetIndex < 0 ? [] : groupedTabs.slice(0, targetIndex);
}

function hasTabsToLeft(tab: QueryTab) {
  return tabsToLeftInGroup(tab).length > 0;
}

function closeTabsToLeftFromTab(tab: QueryTab) {
  // Mirror the close-right path: compute the ids from the sorted display
  // order (fixedTabs/regularTabs), not the underlying array order, so the
  // menu closes exactly the tabs shown to the left of the target.
  const tabsToClose = tabsToLeftInGroup(tab).map((item) => item.id);
  const finalActiveTabId = queryStore.activeTabId && !tabsToClose.includes(queryStore.activeTabId) ? queryStore.activeTabId : tab.id;
  queryStore.closeTabsByIds(tabsToClose, finalActiveTabId);
}

function hasSpecialRegularSurfaceToRight(surface: SpecialRegularSurface) {
  return surface === "settings" && !!props.driverStoreOpen;
}

function closeSpecialRegularSurfacesToRight(surface: SpecialRegularSurface) {
  if (surface !== "settings" || !props.driverStoreOpen) return;
  const shouldActivateSettings = !!props.driverStoreActive;
  emit("close-driver-store");
  if (shouldActivateSettings) emit("activate-settings-page");
}

function closeAllRegularSurfaces() {
  queryStore.closeRegularTabs();
  closeSpecialRegularSurfaces();
}

function closeOtherActiveTabs() {
  if (props.settingsPageActive) {
    queryStore.closeRegularTabs();
    closeSpecialRegularSurfaces("settings");
    return;
  }
  if (props.driverStoreActive) {
    queryStore.closeRegularTabs();
    closeSpecialRegularSurfaces("driverStore");
    return;
  }

  const tab = queryStore.tabs.find((item) => item.id === queryStore.activeTabId);
  if (!tab) return;
  if (tab.pinned) queryStore.closeOtherFixedTabs(tab.id);
  else closeOtherRegularTabsFromTab(tab);
}

defineExpose({ closeOtherActiveTabs });

function getSpecialRegularTabMenuItems(surface: SpecialRegularSurface): ContextMenuItem[] {
  const keep = surface;
  const closeCurrent = surface === "driverStore" ? () => emit("close-driver-store") : () => emit("close-settings-page");
  const closeOtherDisabled = regularSurfaceCount.value <= 1;
  const closeOtherLabel = hasFixedTabs.value ? t("contextMenu.closeOtherRegularTabs") : t("contextMenu.closeOtherTabs");
  const closeAllLabel = hasFixedTabs.value ? t("contextMenu.closeAllRegularTabs") : t("contextMenu.closeAllTabs");

  return [
    {
      label: compactTabTitle.value ? t("contextMenu.fullTabTitle") : t("contextMenu.compactTabTitle"),
      action: toggleCompactTabTitle,
      icon: compactTabTitle.value ? Maximize2 : Minimize2,
    },
    { label: "", separator: true },
    { label: t("contextMenu.closeTab"), action: closeCurrent, icon: X },
    {
      label: closeOtherLabel,
      action: () => {
        queryStore.closeRegularTabs();
        closeSpecialRegularSurfaces(keep);
      },
      disabled: closeOtherDisabled,
      icon: X,
      shortcut: settingsStore.editorSettings.shortcuts.closeOtherTabs,
    },
    {
      label: t("contextMenu.closeRightTabs"),
      action: () => closeSpecialRegularSurfacesToRight(surface),
      disabled: !hasSpecialRegularSurfaceToRight(surface),
      icon: X,
    },
    {
      label: closeAllLabel,
      action: closeAllRegularSurfaces,
      variant: "destructive" as const,
      icon: X,
    },
  ];
}

function getTabMenuItems(tab: QueryTab): ContextMenuItem[] {
  const closeCurrentLabel = tab.pinned ? t("contextMenu.closeFixedTab") : t("contextMenu.closeTab");
  const closeOtherLabel = tab.pinned ? t("contextMenu.closeOtherFixedTabs") : hasFixedTabs.value ? t("contextMenu.closeOtherRegularTabs") : t("contextMenu.closeOtherTabs");
  const closeAllLabel = tab.pinned ? t("contextMenu.closeAllFixedTabs") : hasFixedTabs.value ? t("contextMenu.closeAllRegularTabs") : t("contextMenu.closeAllTabs");
  const closeOtherDisabled = tab.pinned ? fixedTabs.value.length <= 1 : regularSurfaceCount.value <= 1;
  const closeOtherAction = tab.pinned ? () => queryStore.closeOtherFixedTabs(tab.id) : () => closeOtherRegularTabsFromTab(tab);
  const closeAllAction = tab.pinned ? () => queryStore.closeFixedTabs() : closeAllRegularSurfaces;

  return [
    {
      label: compactTabTitle.value ? t("contextMenu.fullTabTitle") : t("contextMenu.compactTabTitle"),
      action: toggleCompactTabTitle,
      icon: compactTabTitle.value ? Maximize2 : Minimize2,
    },
    {
      label: t("contextMenu.renameTab"),
      action: () => startRenameTab(tab),
      icon: Pencil,
      visible: canRenameTab(tab),
    },
    {
      label: t("contextMenu.duplicateTab"),
      action: () => queryStore.duplicateTab(tab.id),
      icon: Copy,
      visible: canRenameTab(tab),
    },
    {
      label: t("contextMenu.copyName"),
      action: async () => {
        try {
          await copyToClipboard(tabDisplayTitle(tab, t));
          toast(t("connection.copied"), 2000);
        } catch (e: any) {
          toast(t("grid.copyFailed", { message: e?.message || String(e) }), 5000);
        }
      },
      icon: Copy,
    },
    {
      label: t("tabs.openInNewWindow"),
      action: () => emit("detach-tab", tab),
      icon: Maximize2,
      visible: !!props.canDetachTabs && isDetachableTab(tab),
    },
    {
      label: t("sidebar.locateActiveTab"),
      action: () => emit("locate-tab", tab),
      icon: Crosshair,
      visible: !!activeTabSidebarTarget(tab),
    },
    { label: "", separator: true },
    {
      label: tab.pinned ? t("contextMenu.unfixTab") : t("contextMenu.fixTab"),
      action: () => queryStore.togglePinnedTab(tab.id),
      icon: Pin,
      iconClass: tab.pinned ? "fill-current" : "",
    },
    { label: "", separator: true },
    { label: closeCurrentLabel, action: () => queryStore.closeTab(tab.id), icon: X },
    {
      label: closeOtherLabel,
      action: closeOtherAction,
      disabled: closeOtherDisabled,
      icon: X,
      shortcut: settingsStore.editorSettings.shortcuts.closeOtherTabs,
    },
    {
      label: t("contextMenu.closeLeftTabs"),
      action: () => closeTabsToLeftFromTab(tab),
      disabled: !hasTabsToLeft(tab),
      icon: X,
    },
    {
      label: t("contextMenu.closeRightTabs"),
      action: () => closeTabsToRightFromTab(tab),
      disabled: !hasTabsToRight(tab),
      icon: X,
    },
    {
      label: closeAllLabel,
      action: closeAllAction,
      variant: "destructive" as const,
      icon: X,
    },
  ];
}

function handleSaveAndClose() {
  const id = queryStore.saveAndClosePendingTab();
  if (id) emit("save-tab", id);
}

function handleDiscardAndClose() {
  queryStore.forceClosePendingTab();
  emit("discard-tab-close");
}

function handleSaveAllAndClose() {
  emit("save-all-tab-close");
}

function handleDiscardAllAndClose() {
  queryStore.forceCloseAllPendingTabs();
  emit("discard-all-tab-close");
}

function handleCancelClose() {
  queryStore.cancelClosePendingTab();
  emit("cancel-tab-close");
}

const tabsContainerRef = ref<HTMLElement | null>(null);
const { hasTabOverflow, scrollThumbLeftPercent, scrollThumbWidthPercent, isScrollbarDragging, updateScrollButtons, onTabsWheel, startScrollbarDrag } = useTabScroll(tabsContainerRef);
const fixedTabsContainerRef = ref<HTMLElement | null>(null);
const {
  hasTabOverflow: hasFixedTabOverflow,
  scrollThumbLeftPercent: fixedScrollThumbLeftPercent,
  scrollThumbWidthPercent: fixedScrollThumbWidthPercent,
  isScrollbarDragging: isFixedScrollbarDragging,
  updateScrollButtons: updateFixedScrollButtons,
  onTabsWheel: onFixedTabsWheel,
  startScrollbarDrag: startFixedScrollbarDrag,
} = useTabScroll(fixedTabsContainerRef);
tabDrag.setDetachBoundsProvider(() => {
  const regular = tabsContainerRef.value?.getBoundingClientRect();
  const fixed = fixedTabsContainerRef.value?.getBoundingClientRect();
  if (!regular) return fixed;
  if (!fixed) return regular;
  return new DOMRect(Math.min(regular.left, fixed.left), Math.min(regular.top, fixed.top), Math.max(regular.right, fixed.right) - Math.min(regular.left, fixed.left), Math.max(regular.bottom, fixed.bottom) - Math.min(regular.top, fixed.top));
});
const tabScrollBehavior = ref<ScrollBehavior>("smooth");

function updateAllScrollButtons() {
  updateScrollButtons();
  updateFixedScrollButtons();
}

function activeTabScrollInline(container: HTMLElement, tabId: string | null): ScrollLogicalPosition {
  if (!tabId) return "center";
  const lastRegularTab = regularTabs.value[regularTabs.value.length - 1];
  const lastFixedTab = fixedTabs.value[fixedTabs.value.length - 1];
  if (container === tabsContainerRef.value && lastRegularTab?.id === tabId) return "end";
  if (container === fixedTabsContainerRef.value && lastFixedTab?.id === tabId) return "end";
  return "center";
}

watch(
  () => queryStore.tabs.map((tab) => `${tab.id}:${tab.pinned ? "1" : "0"}`).join("|"),
  () => {
    nextTick(updateAllScrollButtons);
  },
);

watch(
  () => queryStore.activeTabId,
  () => {
    nextTick(() => {
      if (!isHorizontalTabWrap.value) {
        for (const container of [tabsContainerRef.value, fixedTabsContainerRef.value]) {
          if (!container) continue;
          const activeEl = container.querySelector('[data-active-tab="true"]');
          if (activeEl) {
            activeEl.scrollIntoView(
              isVerticalLayout.value ? { behavior: tabScrollBehavior.value, block: activeTabScrollInline(container, queryStore.activeTabId), inline: "nearest" } : { behavior: tabScrollBehavior.value, block: "nearest", inline: activeTabScrollInline(container, queryStore.activeTabId) },
            );
            break;
          }
        }
      }
      updateAllScrollButtons();
      tabScrollBehavior.value = "smooth";
    });
  },
);

watch(
  () => props.driverStoreActive,
  (show) => {
    if (!show) return;
    nextTick(() => {
      if (isHorizontalTabWrap.value) return;
      const container = tabsContainerRef.value;
      if (!container) return;
      const el = container.querySelector("[data-driver-store-tab]");
      if (el) {
        el.scrollIntoView(isVerticalLayout.value ? { behavior: "smooth", block: "center", inline: "nearest" } : { behavior: "smooth", block: "nearest", inline: "center" });
      }
      updateAllScrollButtons();
    });
  },
);

watch(
  () => props.settingsPageActive,
  (show) => {
    if (!show) return;
    nextTick(() => {
      if (isHorizontalTabWrap.value) return;
      const container = tabsContainerRef.value;
      if (!container) return;
      const el = container.querySelector("[data-settings-page-tab]");
      if (el) {
        el.scrollIntoView(isVerticalLayout.value ? { behavior: "smooth", block: "center", inline: "nearest" } : { behavior: "smooth", block: "nearest", inline: "center" });
      }
      updateAllScrollButtons();
    });
  },
);

function tabColorStyle(tab: QueryTab) {
  const color = connectionColor(tab.connectionId);
  const isActive = tab.id === queryStore.activeTabId && !props.driverStoreActive && !props.settingsPageActive;
  const isClassic = isClassicLayout.value;
  if (!color) {
    if (isClassic) {
      return isActive ? { boxShadow: "inset 0 -2px 0 var(--ring)" } : undefined;
    }
    return isActive
      ? {
          borderColor: "var(--ring)",
        }
      : undefined;
  }

  if (isClassic) {
    return {
      "--app-tab-background": hexToRgba(color, isActive ? 0.16 : 0.07),
      "--app-tab-hover-background": hexToRgba(color, 0.14),
      boxShadow: isActive ? `inset 0 -2px 0 ${color}` : undefined,
    };
  }

  return {
    "--app-tab-background": hexToRgba(color, isActive ? 0.16 : 0.09),
    "--app-tab-hover-background": hexToRgba(color, 0.16),
    borderColor: isActive ? hexToRgba(color, 0.72) : hexToRgba(color, 0.18),
  };
}

function specialTabActiveStyle(active: boolean | undefined): CSSProperties | undefined {
  if (!active) return undefined;
  return isClassicLayout.value ? { boxShadow: "inset 0 -2px 0 var(--ring)" } : { borderColor: "var(--ring)" };
}

function tabIconClass(tab: QueryTab) {
  if (tab.externalSqlFileMissing) return "text-amber-600 dark:text-amber-400";
  if (tab.mode === "mq") return "";
  if (tab.mode === "databases" || tab.mode === "objects") return "text-amber-500 dark:text-amber-400";
  if (tab.mode === "data" || tab.mode === "mongo" || tab.mode === "vector" || tab.mode === "redis" || tab.mode === "hbase" || tab.mode === "structure") return "text-emerald-600 dark:text-emerald-400";
  return "text-blue-600 dark:text-blue-400";
}

function tabDatabaseIconType(tab: QueryTab) {
  const connection = connectionStore.getConfig(tab.connectionId);
  if (!connection) return "mq";
  if (connection.db_type === "mq") {
    const externalConfig = connection.external_config as { systemKind?: unknown } | undefined;
    const systemKind = typeof externalConfig?.systemKind === "string" ? externalConfig.systemKind : "";
    if (connection.driver_profile === "kafka" || systemKind === "kafka") return "kafka";
    if (connection.driver_profile === "rocketmq" || systemKind === "rocketmq") return "rocketmq";
    if (connection.driver_profile === "rabbitmq" || systemKind === "rabbitmq") return "rabbitmq";
    if (connection.driver_profile === "pulsar" || systemKind === "pulsar") return "pulsar";
  }
  return connection.driver_profile || connection.db_type;
}

const showRegularTabScrollbar = computed(() => hasTabOverflow.value && !isHorizontalTabWrap.value && !isVerticalLayout.value);
const showFixedTabScrollbar = computed(() => hasFixedTabOverflow.value && !isHorizontalTabWrap.value && !isVerticalLayout.value);
const showRegularTabOverflowControls = computed(() => regularTabs.value.length > 0 && hasTabOverflow.value && !isHorizontalTabWrap.value && !isVerticalLayout.value);
const regularTabOverflowOpen = ref(false);
const fixedTabOverflowOpen = ref(false);
const tabSearchQuery = ref("");
const filteredOpenTabs = computed(() => {
  const query = tabSearchQuery.value.trim().toLocaleLowerCase();
  if (!query) return displayedTabs.value;
  return displayedTabs.value.filter((tab) => tabMatchesSearch(tab, query));
});

function tabMatchesSearch(tab: QueryTab, query: string) {
  const connectionName = connectionStore.getConfig(tab.connectionId)?.name || "";
  return tabTitleText(tab).toLocaleLowerCase().includes(query) || tab.title.toLocaleLowerCase().includes(query) || connectionName.toLocaleLowerCase().includes(query);
}

const filteredRegularTabs = computed(() => {
  const query = tabSearchQuery.value.trim().toLocaleLowerCase();
  return query ? regularTabs.value.filter((tab) => tabMatchesSearch(tab, query)) : regularTabs.value;
});
const filteredFixedTabs = computed(() => {
  const query = tabSearchQuery.value.trim().toLocaleLowerCase();
  return query ? fixedTabs.value.filter((tab) => tabMatchesSearch(tab, query)) : fixedTabs.value;
});
const groupedFilteredRegularTabs = computed(() => buildTabGroupSections(filteredRegularTabs.value));
const groupedFilteredFixedTabs = computed(() => buildTabGroupSections(filteredFixedTabs.value));
const hasVisibleFixedTabs = computed(() => filteredFixedTabs.value.length > 0);
const tabBarClass = computed(() => [
  isVerticalLayout.value
    ? `vertical-tab-layout h-full min-h-0 w-60 flex-col bg-background ${settingsStore.editorSettings.tabPlacement === "right" ? "border-l" : "border-r"}`
    : isClassicLayout.value
      ? "w-full bg-muted app-tab-bar--classic-horizontal"
      : `w-full bg-background ${settingsStore.editorSettings.tabPlacement === "bottom" ? "border-t" : "border-b"}`,
  hasFixedTabs.value ? "flex-col" : "",
  isClassicLayout.value && hasFixedTabs.value && !isVerticalLayout.value ? "border-b" : "",
]);
const regularTabRowClass = computed(() => {
  if (isVerticalLayout.value) return ["vertical-tab-row vertical-tab-row--regular min-h-0 flex-1 flex-col items-stretch overflow-hidden"];
  if (isHorizontalTabWrap.value) {
    return ["shrink-0", isClassicLayout.value ? "min-h-9 items-stretch" : "min-h-10 items-center px-2", isClassicLayout.value && !hasFixedTabs.value ? "border-b" : ""];
  }
  return ["shrink-0", isClassicLayout.value ? "h-9 items-stretch" : "h-10 items-center px-2", isClassicLayout.value && !hasFixedTabs.value ? "border-b" : ""];
});
const fixedTabRowClass = computed(() => {
  if (isVerticalLayout.value) return "vertical-tab-row vertical-tab-row--fixed flex-col overflow-hidden border-border/70 bg-muted/45 py-1 dark:bg-muted/25";
  if (isHorizontalTabWrap.value) {
    return ["shrink-0", isClassicLayout.value ? "min-h-8 items-stretch border-border/80 bg-background/45 dark:border-border/45 dark:bg-background/20" : "min-h-9 items-center border-border/70 bg-muted/45 px-2 dark:bg-muted/25"];
  }
  return ["shrink-0", isClassicLayout.value ? "h-8 items-stretch border-border/80 bg-background/45 dark:border-border/45 dark:bg-background/20" : "h-9 items-center border-border/70 bg-muted/45 px-2 dark:bg-muted/25"];
});

watch(regularTabOverflowOpen, (open) => {
  tabSearchQuery.value = "";
  if (open) nextTick(() => document.querySelector<HTMLInputElement>('[data-tab-search-input="regular"]')?.focus());
});

watch(fixedTabOverflowOpen, (open) => {
  tabSearchQuery.value = "";
  if (open) nextTick(() => document.querySelector<HTMLInputElement>('[data-tab-search-input="fixed"]')?.focus());
});

function tabMenuIcon(tab: QueryTab) {
  if (tab.externalSqlFileMissing) return AlertTriangle;
  if (tab.mode === "data" || tab.mode === "mongo" || tab.mode === "redis" || tab.mode === "hbase") return Table2;
  if (tab.mode === "vector") return TableProperties;
  if (tab.mode === "etcd" || tab.mode === "zookeeper" || tab.mode === "consul") return KeyRound;
  if (tab.mode === "consul-overview") return Gauge;
  if (tab.mode === "etcd-dashboard") return Gauge;
  if (tab.mode === "etcd-access-control") return ShieldCheck;
  if (tab.mode === "nacos") return Network;
  if (tab.mode === "databases") return Database;
  if (tab.mode === "objects") return TableProperties;
  if (tab.mode === "structure") return PencilRuler;
  if (tab.mode === "dameng-jobs") return CalendarClock;
  if (tab.mode === "processlist" || tab.mode === "sqlserver-trace") return Activity;
  if (tab.mode === "mysql-dashboard" || tab.mode === "postgres-dashboard" || tab.mode === "nacos-dashboard") return Gauge;
  if (tab.mode === "dolt-version-control") return GitBranch;
  return Code2;
}

function handleTabClick(tab: QueryTab) {
  if (tabDrag.state.suppressClick) return;
  activateTab(tab.id);
}

function handleTabDoubleClick(tab: QueryTab, event: MouseEvent) {
  event.stopPropagation();
  if (tabDrag.state.suppressClick || (event.target instanceof Element && event.target.closest("button, input, [role='button']"))) return;
  if (tab.mode === "data") {
    if (tab.id !== queryStore.activeTabId) activateTab(tab.id);
    emit("toggle-zen-mode");
    return;
  }
  startRenameTab(tab);
}

function handleTabMouseDown(event: PointerEvent, tabId: string) {
  if (event.button === 0) {
    dispatchBeforeTabSwitch(tabId);
    // Don't preventDefault touch pointerdowns: that would cancel the tab
    // strip's native horizontal scroll, which is how touch users browse an
    // overflowing tab bar.
    if (event.pointerType !== "touch") event.preventDefault();
  }
  if (isManualTabOrder.value) tabDrag.startDrag(event, tabId);
}

function handleTabDragTarget(event: MouseEvent, tab: QueryTab) {
  if (!isManualTabOrder.value) return;
  const draggedTab = queryStore.tabs.find((item) => item.id === tabDrag.state.draggedId);
  if (draggedTab && draggedTab.pinned !== tab.pinned) {
    tabDrag.clearTarget(tab.id);
    return;
  }
  tabDrag.updateTarget(event, tab.id);
}

function tabDropStyle(tabId: string) {
  if (!tabDrag.state.active) return {};
  if (tabDrag.state.draggedId === tabId) return { opacity: 0.4 };
  if (tabDrag.state.targetId !== tabId) return {};
  const dropColor = `var(--ring)`;
  if (isVerticalLayout.value) return tabDrag.state.dropPosition === "before" ? { boxShadow: `inset 0 3px 0 0 ${dropColor}` } : { boxShadow: `inset 0 -3px 0 0 ${dropColor}` };
  return tabDrag.state.dropPosition === "before" ? { boxShadow: `inset 3px 0 0 0 ${dropColor}` } : { boxShadow: `inset -3px 0 0 0 ${dropColor}` };
}

function tabItemWrapperClass() {
  return isClassicLayout.value && !isVerticalLayout.value ? "h-full" : "";
}

type VerticalTabScrollArea = "regular" | "fixed";

type VerticalScrollMetrics = { scrollTop: number; clientHeight: number; scrollHeight: number };

const regularVerticalScrollMetrics: VerticalScrollMetrics = { scrollTop: 0, clientHeight: 0, scrollHeight: 0 };
const fixedVerticalScrollMetrics: VerticalScrollMetrics = { scrollTop: 0, clientHeight: 0, scrollHeight: 0 };
const hasRegularVerticalOverflow = ref(false);
const hasFixedVerticalOverflow = ref(false);
const regularVerticalScrollActivity = createVerticalScrollActivity();
const fixedVerticalScrollActivity = createVerticalScrollActivity();
const isRegularVerticalScrolling = regularVerticalScrollActivity.isScrolling;
const isFixedVerticalScrolling = fixedVerticalScrollActivity.isScrolling;
const isDraggingRegularVerticalScrollbar = ref(false);
const isDraggingFixedVerticalScrollbar = ref(false);
let regularVerticalScrollbarDragOffset = 0;
let fixedVerticalScrollbarDragOffset = 0;
let verticalTabScrollbarResizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => scheduleVerticalScrollMetricsUpdate());
let verticalScrollMetricsAnimationFrame = 0;
const pendingVerticalScrollMetricsAreas = new Set<VerticalTabScrollArea>();
const regularVerticalScrollbarTrackRef = ref<HTMLElement | null>(null);
const fixedVerticalScrollbarTrackRef = ref<HTMLElement | null>(null);
const regularVerticalScrollbarThumbRef = ref<HTMLElement | null>(null);
const fixedVerticalScrollbarThumbRef = ref<HTMLElement | null>(null);
const tabTooltipDelay = computed(() => (isVerticalLayout.value ? 500 : 300));
const tabTooltipSide = computed(() => {
  switch (settingsStore.editorSettings.tabPlacement) {
    case "left":
      return "right";
    case "right":
      return "left";
    case "bottom":
      return "top";
    default:
      return "bottom";
  }
});
// Keep tooltips suppressed for the whole scrollbar drag, not just while scroll events renew the activity timer.
const suppressRegularTabTooltip = computed(() => isRegularVerticalScrolling.value || isDraggingRegularVerticalScrollbar.value);
const suppressFixedTabTooltip = computed(() => isFixedVerticalScrolling.value || isDraggingFixedVerticalScrollbar.value);

function markVerticalScrolling(area: VerticalTabScrollArea) {
  if (area === "regular") regularVerticalScrollActivity.markScrolling();
  else fixedVerticalScrollActivity.markScrolling();
}

function verticalScrollbarGeometry(metrics: VerticalScrollMetrics) {
  const { scrollTop, clientHeight, scrollHeight } = metrics;
  const trackHeight = Math.max(0, clientHeight);
  const maxScrollTop = Math.max(0, scrollHeight - clientHeight);
  if (trackHeight <= 0 || maxScrollTop <= 1) {
    return { thumbTop: 0, thumbHeight: 0, maxThumbTop: 0, maxScrollTop: 0 };
  }
  const thumbHeight = Math.max(24, (clientHeight / scrollHeight) * trackHeight);
  const maxThumbTop = Math.max(0, trackHeight - thumbHeight);
  const thumbTop = maxScrollTop > 0 ? (scrollTop / maxScrollTop) * maxThumbTop : 0;
  return { thumbTop, thumbHeight, maxThumbTop, maxScrollTop };
}

function applyVerticalScrollbarThumbStyle(area: VerticalTabScrollArea): boolean {
  const thumb = area === "regular" ? regularVerticalScrollbarThumbRef.value : fixedVerticalScrollbarThumbRef.value;
  const metrics = area === "regular" ? regularVerticalScrollMetrics : fixedVerticalScrollMetrics;
  if (!thumb) return false;
  const { thumbTop, thumbHeight } = verticalScrollbarGeometry(metrics);
  // Scroll thumb position changes on every scroll frame; update it outside Vue's
  // render path so large tab lists do not re-render while the user scrolls.
  thumb.style.height = `${thumbHeight}px`;
  thumb.style.transform = `translateY(${thumbTop}px)`;
  return true;
}

function updateVerticalScrollMetrics(area: VerticalTabScrollArea) {
  const el = area === "regular" ? tabsContainerRef.value : fixedTabsContainerRef.value;
  const metrics = area === "regular" ? regularVerticalScrollMetrics : fixedVerticalScrollMetrics;
  const overflowRef = area === "regular" ? hasRegularVerticalOverflow : hasFixedVerticalOverflow;
  if (!el) {
    metrics.scrollTop = 0;
    metrics.clientHeight = 0;
    metrics.scrollHeight = 0;
    if (overflowRef.value) overflowRef.value = false;
    applyVerticalScrollbarThumbStyle(area);
    return;
  }
  metrics.scrollTop = el.scrollTop;
  metrics.clientHeight = el.clientHeight;
  metrics.scrollHeight = el.scrollHeight;
  const overflow = metrics.scrollHeight > metrics.clientHeight + 1;
  if (overflowRef.value !== overflow) overflowRef.value = overflow;
  if (!applyVerticalScrollbarThumbStyle(area) && overflow) {
    nextTick(() => applyVerticalScrollbarThumbStyle(area));
  }
}

function scheduleVerticalScrollMetricsUpdate(areas: VerticalTabScrollArea[] = ["regular", "fixed"]) {
  if (!isVerticalLayout.value) return;
  for (const area of areas) pendingVerticalScrollMetricsAreas.add(area);
  if (verticalScrollMetricsAnimationFrame) return;
  verticalScrollMetricsAnimationFrame = window.requestAnimationFrame(() => {
    verticalScrollMetricsAnimationFrame = 0;
    const pending = [...pendingVerticalScrollMetricsAreas];
    pendingVerticalScrollMetricsAreas.clear();
    for (const area of pending) updateVerticalScrollMetrics(area);
  });
}

function onVerticalTabScroll(area: VerticalTabScrollArea) {
  markVerticalScrolling(area);
  scheduleVerticalScrollMetricsUpdate([area]);
}

function setVerticalTabScrollFromPointer(area: VerticalTabScrollArea, clientY: number, offset: number, track: HTMLElement) {
  const scroller = area === "regular" ? tabsContainerRef.value : fixedTabsContainerRef.value;
  const metrics = area === "regular" ? regularVerticalScrollMetrics : fixedVerticalScrollMetrics;
  if (!scroller) return;
  const rect = track.getBoundingClientRect();
  const { maxThumbTop, maxScrollTop } = verticalScrollbarGeometry(metrics);
  if (maxThumbTop <= 0) return;
  const thumbTop = Math.min(maxThumbTop, Math.max(0, clientY - rect.top - offset));
  scroller.scrollTop = (thumbTop / maxThumbTop) * maxScrollTop;
  updateVerticalScrollMetrics(area);
}

function stopRegularVerticalScrollbarDrag() {
  const wasDragging = isDraggingRegularVerticalScrollbar.value;
  isDraggingRegularVerticalScrollbar.value = false;
  window.removeEventListener("pointermove", onRegularVerticalScrollbarPointerMove);
  window.removeEventListener("pointerup", stopRegularVerticalScrollbarDrag);
  window.removeEventListener("pointercancel", stopRegularVerticalScrollbarDrag);
  // Renew the clear timer so a thumb click with no scroll still re-enables tooltips.
  if (wasDragging) markVerticalScrolling("regular");
}

function stopFixedVerticalScrollbarDrag() {
  const wasDragging = isDraggingFixedVerticalScrollbar.value;
  isDraggingFixedVerticalScrollbar.value = false;
  window.removeEventListener("pointermove", onFixedVerticalScrollbarPointerMove);
  window.removeEventListener("pointerup", stopFixedVerticalScrollbarDrag);
  window.removeEventListener("pointercancel", stopFixedVerticalScrollbarDrag);
  if (wasDragging) markVerticalScrolling("fixed");
}

function onRegularVerticalScrollbarPointerMove(event: PointerEvent) {
  event.preventDefault();
  const track = regularVerticalScrollbarTrackRef.value;
  if (!track) return;
  setVerticalTabScrollFromPointer("regular", event.clientY, regularVerticalScrollbarDragOffset, track);
}

function onFixedVerticalScrollbarPointerMove(event: PointerEvent) {
  event.preventDefault();
  const track = fixedVerticalScrollbarTrackRef.value;
  if (!track) return;
  setVerticalTabScrollFromPointer("fixed", event.clientY, fixedVerticalScrollbarDragOffset, track);
}

function onRegularVerticalScrollbarTrackPointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  event.preventDefault();
  const track = event.currentTarget as HTMLElement;
  const { thumbHeight } = verticalScrollbarGeometry(regularVerticalScrollMetrics);
  regularVerticalScrollbarDragOffset = thumbHeight / 2;
  setVerticalTabScrollFromPointer("regular", event.clientY, regularVerticalScrollbarDragOffset, track);
  isDraggingRegularVerticalScrollbar.value = true;
  markVerticalScrolling("regular");
  window.addEventListener("pointermove", onRegularVerticalScrollbarPointerMove);
  window.addEventListener("pointerup", stopRegularVerticalScrollbarDrag);
  window.addEventListener("pointercancel", stopRegularVerticalScrollbarDrag);
}

function onRegularVerticalScrollbarThumbPointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const track = (event.currentTarget as HTMLElement).parentElement;
  if (!track) return;
  const { thumbTop } = verticalScrollbarGeometry(regularVerticalScrollMetrics);
  regularVerticalScrollbarDragOffset = event.clientY - track.getBoundingClientRect().top - thumbTop;
  isDraggingRegularVerticalScrollbar.value = true;
  markVerticalScrolling("regular");
  window.addEventListener("pointermove", onRegularVerticalScrollbarPointerMove);
  window.addEventListener("pointerup", stopRegularVerticalScrollbarDrag);
  window.addEventListener("pointercancel", stopRegularVerticalScrollbarDrag);
}

function onFixedVerticalScrollbarTrackPointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  event.preventDefault();
  const track = event.currentTarget as HTMLElement;
  const { thumbHeight } = verticalScrollbarGeometry(fixedVerticalScrollMetrics);
  fixedVerticalScrollbarDragOffset = thumbHeight / 2;
  setVerticalTabScrollFromPointer("fixed", event.clientY, fixedVerticalScrollbarDragOffset, track);
  isDraggingFixedVerticalScrollbar.value = true;
  markVerticalScrolling("fixed");
  window.addEventListener("pointermove", onFixedVerticalScrollbarPointerMove);
  window.addEventListener("pointerup", stopFixedVerticalScrollbarDrag);
  window.addEventListener("pointercancel", stopFixedVerticalScrollbarDrag);
}

function onFixedVerticalScrollbarThumbPointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  const track = (event.currentTarget as HTMLElement).parentElement;
  if (!track) return;
  const { thumbTop } = verticalScrollbarGeometry(fixedVerticalScrollMetrics);
  fixedVerticalScrollbarDragOffset = event.clientY - track.getBoundingClientRect().top - thumbTop;
  isDraggingFixedVerticalScrollbar.value = true;
  markVerticalScrolling("fixed");
  window.addEventListener("pointermove", onFixedVerticalScrollbarPointerMove);
  window.addEventListener("pointerup", stopFixedVerticalScrollbarDrag);
  window.addEventListener("pointercancel", stopFixedVerticalScrollbarDrag);
}

function onRegularTabScroll() {
  if (isVerticalLayout.value) onVerticalTabScroll("regular");
  else updateScrollButtons();
}

function onFixedTabScroll() {
  if (isVerticalLayout.value) onVerticalTabScroll("fixed");
  else updateFixedScrollButtons();
}

watch(
  [
    tabsContainerRef,
    fixedTabsContainerRef,
    isVerticalLayout,
    () => queryStore.tabs.length,
    () => hasVisibleFixedTabs.value,
    // Content height can change without the scroller box resizing (group collapse, search filter).
    collapsedTabGroupKeys,
    tabSearchQuery,
  ],
  () => {
    verticalTabScrollbarResizeObserver?.disconnect();
    if (!isVerticalLayout.value || !verticalTabScrollbarResizeObserver) return;
    for (const el of [tabsContainerRef.value, fixedTabsContainerRef.value]) {
      if (el) verticalTabScrollbarResizeObserver.observe(el);
    }
    scheduleVerticalScrollMetricsUpdate();
  },
  { flush: "post", immediate: true },
);

const tabsContainerStyle = computed<CSSProperties>(() =>
  isVerticalLayout.value
    ? {
        msOverflowStyle: "none",
        scrollbarWidth: "none",
        WebkitOverflowScrolling: "touch",
      }
    : {
        msOverflowStyle: "none",
        scrollbarWidth: "none",
        WebkitOverflowScrolling: "touch",
      },
);

function onRegularTabsWheel(event: WheelEvent) {
  if (!isVerticalLayout.value) onTabsWheel(event);
}

function onFixedTabsContainerWheel(event: WheelEvent) {
  if (!isVerticalLayout.value) onFixedTabsWheel(event);
}

const tabScrollbarThumbStyle = computed<CSSProperties>(() => ({
  insetInlineStart: `${scrollThumbLeftPercent.value}%`,
  width: `${scrollThumbWidthPercent.value}%`,
}));

const fixedTabScrollbarThumbStyle = computed<CSSProperties>(() => ({
  insetInlineStart: `${fixedScrollThumbLeftPercent.value}%`,
  width: `${fixedScrollThumbWidthPercent.value}%`,
}));

const tabTailDragRegionClass = computed(() => (isVerticalLayout.value || showRegularTabOverflowControls.value || isHorizontalTabWrap.value ? "w-0 flex-none self-stretch" : "min-w-8 flex-1 self-stretch"));
const fixedTabTailDragRegionClass = computed(() => (isVerticalLayout.value || showFixedTabScrollbar.value || isHorizontalTabWrap.value ? "w-0 flex-none self-stretch" : "min-w-8 flex-1 self-stretch"));

const tabOverflowControlClass = computed(() =>
  isClassicLayout.value
    ? "h-full w-8 border-r border-border/80 dark:border-border/45 bg-background/80 text-foreground/75 hover:bg-accent hover:text-foreground disabled:cursor-default disabled:opacity-40"
    : "h-7 w-7 rounded-md border border-border/60 bg-background text-foreground/70 hover:border-border hover:text-foreground",
);

function dispatchBeforeTabSwitch(tabId: string) {
  if (tabId === queryStore.activeTabId) return;
  window.dispatchEvent(new CustomEvent("dbx:before-tab-switch", { detail: { tabId, fromTabId: queryStore.activeTabId } }));
}

function activateTab(tabId: string) {
  dispatchBeforeTabSwitch(tabId);
  tabScrollBehavior.value = "auto";
  queryStore.activeTabId = tabId;
  emit("activate-tab");
}

function activateTabFromOverflow(tabId: string, kind: "regular" | "fixed") {
  activateTab(tabId);
  if (kind === "regular") regularTabOverflowOpen.value = false;
  else fixedTabOverflowOpen.value = false;
}

function closeTabFromOverflow(tabId: string, event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
  queryStore.closeTab(tabId);
}

function onOverflowItemKeydown(event: KeyboardEvent, tabId: string, kind: "regular" | "fixed") {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  activateTabFromOverflow(tabId, kind);
}
</script>

<template>
  <div v-if="queryStore.tabs.length > 0 || driverStoreOpen || settingsPageOpen" data-main-tab-bar class="app-tab-bar relative flex w-full min-w-0 overflow-hidden" :class="[tabBarClass, isVerticalLayout ? 'min-h-0' : 'shrink-0', { 'ring-2 ring-primary ring-inset': detachedDropTarget }]">
    <div v-if="isVerticalLayout" class="connection-tree-search relative z-10 shrink-0 flex items-center border-b px-2" :class="isClassicLayout ? 'h-9' : 'h-10'">
      <div class="relative min-w-0 flex-1">
        <Search class="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
        <input v-model="tabSearchQuery" type="search" autocapitalize="off" autocorrect="off" spellcheck="false" class="h-6 w-full rounded border border-border bg-background pl-7 pr-2 text-xs outline-none focus:border-ring" :placeholder="t('tabs.searchOpenTabs')" />
      </div>
    </div>
    <div class="flex w-full min-w-0 overflow-hidden" :class="regularTabRowClass">
      <div class="app-tab-strip relative min-w-0 flex-1 overflow-hidden" :class="isVerticalLayout ? 'flex min-h-0 flex-col' : 'h-full'">
        <div v-if="showRegularTabScrollbar" class="app-tab-scrollbar" :class="{ 'app-tab-scrollbar--dragging': isScrollbarDragging }" @pointerdown="startScrollbarDrag">
          <div class="app-tab-scrollbar__thumb" :style="tabScrollbarThumbStyle" />
        </div>
        <div
          ref="tabsContainerRef"
          class="app-tab-scroll w-full min-w-0"
          :class="[
            isVerticalLayout ? 'vertical-tab-scroller min-h-0 flex-1 overflow-y-auto overflow-x-hidden pt-0.5 pb-1' : isClassicLayout ? 'flex min-w-0 flex-1 h-full items-center overflow-x-auto' : 'flex min-w-0 flex-1 h-full items-center gap-1.5 overflow-x-auto py-1.5',
            isHorizontalTabWrap ? 'wrap-mode' : '',
            isHorizontalTabWrap && isClassicLayout ? 'classic-wrap' : '',
          ]"
          :style="tabsContainerStyle"
          @scroll.passive="onRegularTabScroll"
          @wheel="onRegularTabsWheel($event)"
        >
          <template v-if="isGroupingEnabled">
            <div v-for="group in groupedFilteredRegularTabs" :key="group.key" class="tab-group-section" :class="isVerticalLayout ? 'tab-group-section--vertical' : 'tab-group-section--inline'">
              <button
                type="button"
                class="tab-group-header"
                :class="{
                  'tab-group-header--vertical': isVerticalLayout,
                  'tab-group-header--collapsed': isTabGroupCollapsed('regular', group.key),
                }"
                :aria-expanded="!isTabGroupCollapsed('regular', group.key)"
                :aria-label="isTabGroupCollapsed('regular', group.key) ? t('sidebar.expand') : t('sidebar.collapse')"
                @click="toggleTabGroupCollapse('regular', group.key)"
              >
                <ChevronRight v-if="isTabGroupCollapsed('regular', group.key)" class="h-3.5 w-3.5 shrink-0" />
                <ChevronDown v-else class="h-3.5 w-3.5 shrink-0" />
                <DatabaseIcon :db-type="group.iconType" class="h-3.5 w-3.5 shrink-0" />
                <span class="min-w-0 truncate">{{ group.label }}</span>
              </button>
              <template v-if="isGroupTabsVisible('regular', group.key)">
                <CustomContextMenu v-for="tab in group.tabs" :key="tab.id" :items="getTabMenuItems(tab)" v-slot="{ onContextMenu }">
                  <div :class="tabItemWrapperClass()" @contextmenu="onContextMenu">
                    <TabBarTooltip :tab="tab" :disabled="suppressRegularTabTooltip" :delay="tabTooltipDelay" :side="tabTooltipSide">
                      <div
                        class="app-tab-pill group flex cursor-default items-center gap-1 px-2 text-xs transition-colors whitespace-nowrap select-none"
                        :class="
                          isClassicLayout
                            ? [
                                compactTabTitle ? 'min-w-24' : 'min-w-38',
                                'h-full border-r border-border/80 font-medium dark:border-border/45',
                                tab.id === queryStore.activeTabId && !driverStoreActive && !settingsPageActive ? 'bg-background text-foreground' : 'text-foreground/70 hover:text-foreground/90',
                              ]
                            : [compactTabTitle ? 'min-w-24' : 'min-w-38', 'h-7 rounded-md border', tab.id === queryStore.activeTabId && !driverStoreActive && !settingsPageActive ? 'text-foreground font-medium' : 'border-border/60 text-foreground/70 hover:border-border hover:text-foreground/90']
                        "
                        :style="[tabColorStyle(tab), tabDropStyle(tab.id)]"
                        :data-active-tab="tab.id === queryStore.activeTabId && !driverStoreActive && !settingsPageActive"
                        @click="handleTabClick(tab)"
                        @dblclick="handleTabDoubleClick(tab, $event)"
                        @mousedown.middle.prevent="queryStore.closeTab(tab.id)"
                        @pointerdown="handleTabMouseDown($event, tab.id)"
                        @mouseenter="handleTabDragTarget($event, tab)"
                        @mousemove="handleTabDragTarget($event, tab)"
                        @mouseleave="tabDrag.clearTarget(tab.id)"
                      >
                        <TabExecutionStatus :tab="tab">
                          <span class="shrink-0" :class="tabIconClass(tab)">
                            <AlertTriangle v-if="tab.externalSqlFileMissing" class="h-3.5 w-3.5" />
                            <Table2 v-else-if="tab.mode === 'data' || tab.mode === 'mongo' || tab.mode === 'redis' || tab.mode === 'hbase'" class="h-3.5 w-3.5" />
                            <DatabaseIcon v-else-if="tab.mode === 'mq'" :db-type="tabDatabaseIconType(tab)" class="h-3.5 w-3.5" />
                            <TableProperties v-else-if="tab.mode === 'vector'" class="h-3.5 w-3.5" />
                            <KeyRound v-else-if="tab.mode === 'etcd' || tab.mode === 'zookeeper' || tab.mode === 'consul'" class="h-3.5 w-3.5" />
                            <Gauge v-else-if="tab.mode === 'consul-overview'" class="h-3.5 w-3.5" />
                            <Gauge v-else-if="tab.mode === 'etcd-dashboard'" class="h-3.5 w-3.5" />
                            <ShieldCheck v-else-if="tab.mode === 'etcd-access-control'" class="h-3.5 w-3.5" />
                            <Network v-else-if="tab.mode === 'nacos'" class="h-3.5 w-3.5" />
                            <Database v-else-if="tab.mode === 'databases'" class="h-3.5 w-3.5" />
                            <TableProperties v-else-if="tab.mode === 'objects'" class="h-3.5 w-3.5" />
                            <PencilRuler v-else-if="tab.mode === 'structure'" class="h-3.5 w-3.5" />
                            <CalendarClock v-else-if="tab.mode === 'dameng-jobs'" class="h-3.5 w-3.5" />
                            <Activity v-else-if="tab.mode === 'processlist' || tab.mode === 'sqlserver-trace'" class="h-3.5 w-3.5" />
                            <Gauge v-else-if="tab.mode === 'mysql-dashboard' || tab.mode === 'postgres-dashboard' || tab.mode === 'nacos-dashboard'" class="h-3.5 w-3.5" />
                            <GitBranch v-else-if="tab.mode === 'dolt-version-control'" class="h-3.5 w-3.5" />
                            <Code2 v-else class="h-3.5 w-3.5" />
                          </span>
                        </TabExecutionStatus>
                        <input
                          v-if="editingTabId === tab.id"
                          v-model="editingTitle"
                          :data-tab-title-input="tab.id"
                          :aria-label="t('contextMenu.renameTab')"
                          class="h-5 min-w-0 flex-1 rounded border border-ring bg-background px-1.5 text-xs font-normal text-foreground outline-none"
                          @click.stop
                          @mousedown.stop
                          @keydown.enter.prevent="commitRenameTab(tab)"
                          @keydown.escape.prevent="cancelRenameTab"
                          @blur="commitRenameTab(tab)"
                        />
                        <span v-else class="inline-flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
                          <span v-if="isDirtyTab(tab)" aria-hidden="true" class="dirty-tab-marker">*</span>
                          <span class="min-w-0 flex-1 truncate" :style="tabTitleStyle(tab)">{{ tabTitleText(tab) }}</span>
                        </span>
                        <ReadOnlySessionControl :connection-id="tab.connectionId" compact />
                        <button class="rounded hover:bg-muted-foreground/20 p-0.5 shrink-0" @click.stop="queryStore.closeTab(tab.id)">
                          <X class="h-3 w-3" />
                        </button>
                      </div>
                    </TabBarTooltip>
                  </div>
                </CustomContextMenu>
              </template>
            </div>
          </template>
          <template v-else>
            <CustomContextMenu v-for="tab in filteredRegularTabs" :key="tab.id" :items="getTabMenuItems(tab)" v-slot="{ onContextMenu }">
              <div :class="tabItemWrapperClass()" @contextmenu="onContextMenu">
                <TabBarTooltip :tab="tab" :disabled="suppressRegularTabTooltip" :delay="tabTooltipDelay" :side="tabTooltipSide">
                  <div
                    class="app-tab-pill group flex cursor-default items-center gap-1 px-2 text-xs transition-colors whitespace-nowrap select-none"
                    :class="
                      isClassicLayout
                        ? [
                            compactTabTitle ? 'min-w-24' : 'min-w-38',
                            'h-full border-r border-border/80 font-medium dark:border-border/45',
                            tab.id === queryStore.activeTabId && !driverStoreActive && !settingsPageActive ? 'bg-background text-foreground' : 'text-foreground/70 hover:text-foreground/90',
                          ]
                        : [compactTabTitle ? 'min-w-24' : 'min-w-38', 'h-7 rounded-md border', tab.id === queryStore.activeTabId && !driverStoreActive && !settingsPageActive ? 'text-foreground font-medium' : 'border-border/60 text-foreground/70 hover:border-border hover:text-foreground/90']
                    "
                    :style="[tabColorStyle(tab), tabDropStyle(tab.id)]"
                    :data-active-tab="tab.id === queryStore.activeTabId && !driverStoreActive && !settingsPageActive"
                    @click="handleTabClick(tab)"
                    @dblclick="handleTabDoubleClick(tab, $event)"
                    @mousedown.middle.prevent="queryStore.closeTab(tab.id)"
                    @pointerdown="handleTabMouseDown($event, tab.id)"
                    @mouseenter="handleTabDragTarget($event, tab)"
                    @mousemove="handleTabDragTarget($event, tab)"
                    @mouseleave="tabDrag.clearTarget(tab.id)"
                  >
                    <TabExecutionStatus :tab="tab">
                      <span class="shrink-0" :class="tabIconClass(tab)">
                        <AlertTriangle v-if="tab.externalSqlFileMissing" class="h-3.5 w-3.5" />
                        <Table2 v-else-if="tab.mode === 'data' || tab.mode === 'mongo' || tab.mode === 'redis' || tab.mode === 'hbase'" class="h-3.5 w-3.5" />
                        <DatabaseIcon v-else-if="tab.mode === 'mq'" :db-type="tabDatabaseIconType(tab)" class="h-3.5 w-3.5" />
                        <TableProperties v-else-if="tab.mode === 'vector'" class="h-3.5 w-3.5" />
                        <KeyRound v-else-if="tab.mode === 'etcd' || tab.mode === 'zookeeper' || tab.mode === 'consul'" class="h-3.5 w-3.5" />
                        <Gauge v-else-if="tab.mode === 'consul-overview'" class="h-3.5 w-3.5" />
                        <Gauge v-else-if="tab.mode === 'etcd-dashboard'" class="h-3.5 w-3.5" />
                        <ShieldCheck v-else-if="tab.mode === 'etcd-access-control'" class="h-3.5 w-3.5" />
                        <Network v-else-if="tab.mode === 'nacos'" class="h-3.5 w-3.5" />
                        <Database v-else-if="tab.mode === 'databases'" class="h-3.5 w-3.5" />
                        <TableProperties v-else-if="tab.mode === 'objects'" class="h-3.5 w-3.5" />
                        <PencilRuler v-else-if="tab.mode === 'structure'" class="h-3.5 w-3.5" />
                        <CalendarClock v-else-if="tab.mode === 'dameng-jobs'" class="h-3.5 w-3.5" />
                        <Activity v-else-if="tab.mode === 'processlist' || tab.mode === 'sqlserver-trace'" class="h-3.5 w-3.5" />
                        <Gauge v-else-if="tab.mode === 'mysql-dashboard' || tab.mode === 'postgres-dashboard' || tab.mode === 'nacos-dashboard'" class="h-3.5 w-3.5" />
                        <GitBranch v-else-if="tab.mode === 'dolt-version-control'" class="h-3.5 w-3.5" />
                        <Code2 v-else class="h-3.5 w-3.5" />
                      </span>
                    </TabExecutionStatus>
                    <input
                      v-if="editingTabId === tab.id"
                      v-model="editingTitle"
                      :data-tab-title-input="tab.id"
                      :aria-label="t('contextMenu.renameTab')"
                      class="h-5 min-w-0 flex-1 rounded border border-ring bg-background px-1.5 text-xs font-normal text-foreground outline-none"
                      @click.stop
                      @mousedown.stop
                      @keydown.enter.prevent="commitRenameTab(tab)"
                      @keydown.escape.prevent="cancelRenameTab"
                      @blur="commitRenameTab(tab)"
                    />
                    <span v-else class="inline-flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
                      <span v-if="isDirtyTab(tab)" aria-hidden="true" class="dirty-tab-marker">*</span>
                      <span class="min-w-0 flex-1 truncate" :style="tabTitleStyle(tab)">{{ tabTitleText(tab) }}</span>
                    </span>
                    <ReadOnlySessionControl :connection-id="tab.connectionId" compact />
                    <button class="rounded hover:bg-muted-foreground/20 p-0.5 shrink-0" @click.stop="queryStore.closeTab(tab.id)">
                      <X class="h-3 w-3" />
                    </button>
                  </div>
                </TabBarTooltip>
              </div>
            </CustomContextMenu>
          </template>

          <!-- Settings Page Tab -->
          <CustomContextMenu v-if="settingsPageOpen" :items="getSpecialRegularTabMenuItems('settings')" v-slot="{ onContextMenu }">
            <div :class="tabItemWrapperClass()" @contextmenu="onContextMenu">
              <div
                data-settings-page-tab
                class="app-tab-pill group flex min-w-36 cursor-default items-center gap-1 px-2 text-xs transition-colors whitespace-nowrap"
                :class="
                  isClassicLayout
                    ? ['h-full border-r border-border/80 dark:border-border/45 font-medium', settingsPageActive ? 'bg-background text-foreground' : 'text-foreground/70 hover:text-foreground/90']
                    : ['h-7 rounded-md border font-medium', settingsPageActive ? 'border-ring text-foreground' : 'border-border/60 text-foreground/70 hover:border-border hover:text-foreground/90']
                "
                :style="specialTabActiveStyle(settingsPageActive)"
                :data-active-tab="settingsPageActive"
                @click="emit('activate-settings-page')"
                @mousedown.middle.prevent="emit('close-settings-page')"
              >
                <span class="shrink-0 text-sky-600 dark:text-sky-400">
                  <Settings class="h-3.5 w-3.5" />
                </span>
                <span class="min-w-0 truncate flex-1">{{ t("settings.title") }}</span>
                <button class="rounded hover:bg-muted-foreground/20 p-0.5 shrink-0" @click.stop="emit('close-settings-page')">
                  <X class="h-3 w-3" />
                </button>
              </div>
            </div>
          </CustomContextMenu>

          <!-- Driver Store Tab -->
          <CustomContextMenu v-if="driverStoreOpen" :items="getSpecialRegularTabMenuItems('driverStore')" v-slot="{ onContextMenu }">
            <div :class="tabItemWrapperClass()" @contextmenu="onContextMenu">
              <div
                data-driver-store-tab
                class="app-tab-pill group flex min-w-38 cursor-default items-center gap-1 px-2 text-xs transition-colors whitespace-nowrap"
                :class="
                  isClassicLayout
                    ? ['h-full border-r border-border/80 dark:border-border/45 font-medium', driverStoreActive ? 'bg-background text-foreground' : 'text-foreground/70 hover:text-foreground/90']
                    : ['h-7 rounded-md border font-medium', driverStoreActive ? 'border-ring text-foreground' : 'border-border/60 text-foreground/70 hover:border-border hover:text-foreground/90']
                "
                :style="specialTabActiveStyle(driverStoreActive)"
                :data-active-tab="driverStoreActive"
                @click="emit('activate-driver-store')"
                @mousedown.middle.prevent="emit('close-driver-store')"
              >
                <span class="shrink-0 text-amber-600 dark:text-amber-400">
                  <Package class="h-3.5 w-3.5" />
                </span>
                <span class="min-w-0 truncate flex-1">{{ t("toolbar.driverManager") }}</span>
                <span v-if="(agentDriverUpdateCount ?? 0) > 0" class="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium leading-none text-white" :aria-label="t('toolbar.updatableDriverCount')">
                  {{ (agentDriverUpdateCount ?? 0) > 99 ? "99+" : agentDriverUpdateCount }}
                </span>
                <button class="rounded hover:bg-muted-foreground/20 p-0.5 shrink-0" @click.stop="emit('close-driver-store')">
                  <X class="h-3 w-3" />
                </button>
              </div>
            </div>
          </CustomContextMenu>
          <div v-if="!isVerticalLayout" :class="tabTailDragRegionClass" data-tauri-drag-region />
        </div>
        <div
          v-if="isVerticalLayout && hasRegularVerticalOverflow"
          ref="regularVerticalScrollbarTrackRef"
          class="vertical-tab-scrollbar vertical-tab-scrollbar--regular"
          :class="{
            'vertical-tab-scrollbar--scrolling': isRegularVerticalScrolling,
            'vertical-tab-scrollbar--dragging': isDraggingRegularVerticalScrollbar,
          }"
          @pointerdown="onRegularVerticalScrollbarTrackPointerDown"
        >
          <div ref="regularVerticalScrollbarThumbRef" class="vertical-tab-scrollbar__thumb" @pointerdown.stop="onRegularVerticalScrollbarThumbPointerDown" />
        </div>
      </div>
      <div v-if="showRegularTabOverflowControls" class="relative z-30 flex shrink-0 items-center">
        <Popover v-model:open="regularTabOverflowOpen">
          <PopoverTrigger as-child>
            <button type="button" :class="['inline-flex shrink-0 items-center justify-center', tabOverflowControlClass].join(' ')" :aria-label="t('tabs.openTabs')" :title="t('tabs.openTabs')">
              <ChevronDown class="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" class="w-auto min-w-56 max-w-80 gap-0 rounded-[6px] p-1" @click.stop @keydown.stop>
            <div class="relative border-b px-1 pb-1">
              <Search class="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input data-tab-search-input="regular" v-model="tabSearchQuery" type="search" :placeholder="t('tabs.searchOpenTabs')" class="h-8 pl-7 text-sm" />
            </div>
            <div class="max-h-[min(70vh,28rem)] overflow-y-auto pt-1">
              <CustomContextMenu v-for="tab in filteredOpenTabs" :key="tab.id" :items="getTabMenuItems(tab)" v-slot="{ onContextMenu }">
                <div
                  class="group flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm outline-hidden hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground"
                  :class="tab.id === queryStore.activeTabId && !driverStoreActive && !settingsPageActive ? 'bg-accent/70 text-accent-foreground' : ''"
                  :title="tabTitleLabel(tab)"
                  role="menuitem"
                  tabindex="0"
                  @click="activateTabFromOverflow(tab.id, 'regular')"
                  @contextmenu="onContextMenu"
                  @keydown="onOverflowItemKeydown($event, tab.id, 'regular')"
                >
                  <TabExecutionStatus :tab="tab">
                    <DatabaseIcon v-if="tab.mode === 'mq'" :db-type="tabDatabaseIconType(tab)" class="h-3.5 w-3.5 shrink-0" />
                    <component :is="tabMenuIcon(tab)" v-else :class="['h-3.5 w-3.5 shrink-0', tabIconClass(tab)]" />
                  </TabExecutionStatus>
                  <span class="inline-flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
                    <span v-if="isDirtyTab(tab)" aria-hidden="true" class="dirty-tab-marker">*</span>
                    <span class="min-w-0 flex-1 truncate" :style="tabTitleStyle(tab)">{{ tabTitleText(tab) }}</span>
                  </span>
                  <ReadOnlySessionControl :connection-id="tab.connectionId" compact />
                  <Pin v-if="tab.pinned" class="h-3 w-3 shrink-0 fill-current text-primary" />
                  <span class="w-5 shrink-0">
                    <button
                      type="button"
                      class="inline-flex rounded p-1 text-muted-foreground opacity-70 hover:bg-muted-foreground/20 hover:text-foreground group-hover:opacity-100"
                      :aria-label="t('contextMenu.closeTab')"
                      :title="t('contextMenu.closeTab')"
                      @click="closeTabFromOverflow(tab.id, $event)"
                      @mousedown.stop
                    >
                      <X class="h-3 w-3" />
                    </button>
                  </span>
                </div>
              </CustomContextMenu>
              <p v-if="filteredOpenTabs.length === 0" class="px-2 py-4 text-center text-sm text-muted-foreground">{{ t("tabs.noMatchingTabs") }}</p>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>

    <div v-if="hasVisibleFixedTabs" class="flex w-full min-w-0 overflow-hidden border-t" :class="fixedTabRowClass">
      <div class="app-tab-strip relative min-w-0 flex-1 overflow-hidden" :class="isVerticalLayout ? 'flex min-h-0 flex-col' : 'h-full'">
        <div v-if="showFixedTabScrollbar" class="app-tab-scrollbar app-tab-scrollbar--bottom" :class="{ 'app-tab-scrollbar--dragging': isFixedScrollbarDragging }" @pointerdown="startFixedScrollbarDrag">
          <div class="app-tab-scrollbar__thumb" :style="fixedTabScrollbarThumbStyle" />
        </div>
        <div
          ref="fixedTabsContainerRef"
          class="app-tab-scroll w-full min-w-0"
          :class="[
            isVerticalLayout ? 'vertical-tab-scroller min-h-0 flex-1 overflow-y-auto overflow-x-hidden pt-0.5 pb-1' : isClassicLayout ? 'flex min-w-0 flex-1 h-full items-center overflow-x-auto' : 'flex min-w-0 flex-1 h-full items-center gap-1.5 overflow-x-auto py-1',
            isHorizontalTabWrap ? 'wrap-mode' : '',
            isHorizontalTabWrap && isClassicLayout ? 'classic-wrap' : '',
          ]"
          :style="tabsContainerStyle"
          @scroll.passive="onFixedTabScroll"
          @wheel="onFixedTabsContainerWheel($event)"
        >
          <template v-if="isGroupingEnabled">
            <div v-for="group in groupedFilteredFixedTabs" :key="group.key" class="tab-group-section" :class="isVerticalLayout ? 'tab-group-section--vertical' : 'tab-group-section--inline'">
              <button
                type="button"
                class="tab-group-header"
                :class="{
                  'tab-group-header--vertical': isVerticalLayout,
                  'tab-group-header--collapsed': isTabGroupCollapsed('fixed', group.key),
                }"
                :aria-expanded="!isTabGroupCollapsed('fixed', group.key)"
                :aria-label="isTabGroupCollapsed('fixed', group.key) ? t('sidebar.expand') : t('sidebar.collapse')"
                @click="toggleTabGroupCollapse('fixed', group.key)"
              >
                <ChevronRight v-if="isTabGroupCollapsed('fixed', group.key)" class="h-3.5 w-3.5 shrink-0" />
                <ChevronDown v-else class="h-3.5 w-3.5 shrink-0" />
                <DatabaseIcon :db-type="group.iconType" class="h-3.5 w-3.5 shrink-0" />
                <span class="min-w-0 truncate">{{ group.label }}</span>
              </button>
              <template v-if="isGroupTabsVisible('fixed', group.key)">
                <CustomContextMenu v-for="tab in group.tabs" :key="tab.id" :items="getTabMenuItems(tab)" v-slot="{ onContextMenu }">
                  <div :class="tabItemWrapperClass()" @contextmenu="onContextMenu">
                    <TabBarTooltip :tab="tab" :disabled="suppressFixedTabTooltip" :delay="tabTooltipDelay" :side="tabTooltipSide">
                      <div
                        class="app-tab-pill group flex cursor-default items-center gap-1 px-2 text-xs transition-colors whitespace-nowrap select-none"
                        :class="
                          isClassicLayout
                            ? [
                                compactTabTitle ? 'min-w-24' : 'min-w-38',
                                'h-full border-r border-border/80 font-medium dark:border-border/45',
                                tab.id === queryStore.activeTabId && !driverStoreActive && !settingsPageActive ? 'bg-background text-foreground' : 'text-foreground/70 hover:text-foreground/90',
                              ]
                            : [compactTabTitle ? 'min-w-24' : 'min-w-38', 'h-7 rounded-md border', tab.id === queryStore.activeTabId && !driverStoreActive && !settingsPageActive ? 'text-foreground font-medium' : 'border-border/60 text-foreground/70 hover:border-border hover:text-foreground/90']
                        "
                        :style="[tabColorStyle(tab), tabDropStyle(tab.id)]"
                        :data-active-tab="tab.id === queryStore.activeTabId && !driverStoreActive && !settingsPageActive"
                        @click="handleTabClick(tab)"
                        @dblclick="handleTabDoubleClick(tab, $event)"
                        @mousedown.middle.prevent="queryStore.closeTab(tab.id)"
                        @pointerdown="handleTabMouseDown($event, tab.id)"
                        @mouseenter="handleTabDragTarget($event, tab)"
                        @mousemove="handleTabDragTarget($event, tab)"
                        @mouseleave="tabDrag.clearTarget(tab.id)"
                      >
                        <TabExecutionStatus :tab="tab">
                          <span class="shrink-0" :class="tabIconClass(tab)">
                            <AlertTriangle v-if="tab.externalSqlFileMissing" class="h-3.5 w-3.5" />
                            <Table2 v-else-if="tab.mode === 'data' || tab.mode === 'mongo' || tab.mode === 'redis' || tab.mode === 'hbase'" class="h-3.5 w-3.5" />
                            <DatabaseIcon v-else-if="tab.mode === 'mq'" :db-type="tabDatabaseIconType(tab)" class="h-3.5 w-3.5" />
                            <TableProperties v-else-if="tab.mode === 'vector'" class="h-3.5 w-3.5" />
                            <KeyRound v-else-if="tab.mode === 'etcd' || tab.mode === 'zookeeper' || tab.mode === 'consul'" class="h-3.5 w-3.5" />
                            <Gauge v-else-if="tab.mode === 'consul-overview'" class="h-3.5 w-3.5" />
                            <Gauge v-else-if="tab.mode === 'etcd-dashboard'" class="h-3.5 w-3.5" />
                            <ShieldCheck v-else-if="tab.mode === 'etcd-access-control'" class="h-3.5 w-3.5" />
                            <Network v-else-if="tab.mode === 'nacos'" class="h-3.5 w-3.5" />
                            <Database v-else-if="tab.mode === 'databases'" class="h-3.5 w-3.5" />
                            <TableProperties v-else-if="tab.mode === 'objects'" class="h-3.5 w-3.5" />
                            <PencilRuler v-else-if="tab.mode === 'structure'" class="h-3.5 w-3.5" />
                            <CalendarClock v-else-if="tab.mode === 'dameng-jobs'" class="h-3.5 w-3.5" />
                            <Activity v-else-if="tab.mode === 'processlist' || tab.mode === 'sqlserver-trace'" class="h-3.5 w-3.5" />
                            <Gauge v-else-if="tab.mode === 'mysql-dashboard' || tab.mode === 'postgres-dashboard' || tab.mode === 'nacos-dashboard'" class="h-3.5 w-3.5" />
                            <GitBranch v-else-if="tab.mode === 'dolt-version-control'" class="h-3.5 w-3.5" />
                            <Code2 v-else class="h-3.5 w-3.5" />
                          </span>
                        </TabExecutionStatus>
                        <input
                          v-if="editingTabId === tab.id"
                          v-model="editingTitle"
                          :data-tab-title-input="tab.id"
                          :aria-label="t('contextMenu.renameTab')"
                          class="h-5 min-w-0 flex-1 rounded border border-ring bg-background px-1.5 text-xs font-normal text-foreground outline-none"
                          @click.stop
                          @mousedown.stop
                          @keydown.enter.prevent="commitRenameTab(tab)"
                          @keydown.escape.prevent="cancelRenameTab"
                          @blur="commitRenameTab(tab)"
                        />
                        <span v-else class="inline-flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden text-foreground">
                          <span v-if="isDirtyTab(tab)" aria-hidden="true" class="dirty-tab-marker">*</span>
                          <span class="min-w-0 flex-1 truncate" :style="tabTitleStyle(tab)">{{ tabTitleText(tab) }}</span>
                        </span>
                        <ReadOnlySessionControl :connection-id="tab.connectionId" compact />
                        <button class="rounded p-0.5 text-primary hover:bg-muted-foreground/20 shrink-0" :aria-label="t('contextMenu.unfixTab')" :title="t('contextMenu.unfixTab')" @click.stop="queryStore.togglePinnedTab(tab.id)">
                          <Pin class="h-3 w-3 fill-current" aria-hidden="true" />
                        </button>
                        <button class="rounded hover:bg-muted-foreground/20 p-0.5 shrink-0" @click.stop="queryStore.closeTab(tab.id)">
                          <X class="h-3 w-3" />
                        </button>
                      </div>
                    </TabBarTooltip>
                  </div>
                </CustomContextMenu>
              </template>
            </div>
          </template>
          <template v-else>
            <CustomContextMenu v-for="tab in filteredFixedTabs" :key="tab.id" :items="getTabMenuItems(tab)" v-slot="{ onContextMenu }">
              <div :class="tabItemWrapperClass()" @contextmenu="onContextMenu">
                <TabBarTooltip :tab="tab" :disabled="suppressFixedTabTooltip" :delay="tabTooltipDelay" :side="tabTooltipSide">
                  <div
                    class="app-tab-pill group flex cursor-default items-center gap-1 px-2 text-xs transition-colors whitespace-nowrap select-none"
                    :class="
                      isClassicLayout
                        ? [
                            compactTabTitle ? 'min-w-24' : 'min-w-38',
                            'h-full border-r border-border/80 font-medium dark:border-border/45',
                            tab.id === queryStore.activeTabId && !driverStoreActive && !settingsPageActive ? 'bg-background text-foreground' : 'text-foreground/70 hover:text-foreground/90',
                          ]
                        : [compactTabTitle ? 'min-w-24' : 'min-w-38', 'h-7 rounded-md border', tab.id === queryStore.activeTabId && !driverStoreActive && !settingsPageActive ? 'text-foreground font-medium' : 'border-border/60 text-foreground/70 hover:border-border hover:text-foreground/90']
                    "
                    :style="[tabColorStyle(tab), tabDropStyle(tab.id)]"
                    :data-active-tab="tab.id === queryStore.activeTabId && !driverStoreActive && !settingsPageActive"
                    @click="handleTabClick(tab)"
                    @dblclick="handleTabDoubleClick(tab, $event)"
                    @mousedown.middle.prevent="queryStore.closeTab(tab.id)"
                    @pointerdown="handleTabMouseDown($event, tab.id)"
                    @mouseenter="handleTabDragTarget($event, tab)"
                    @mousemove="handleTabDragTarget($event, tab)"
                    @mouseleave="tabDrag.clearTarget(tab.id)"
                  >
                    <TabExecutionStatus :tab="tab">
                      <span class="shrink-0" :class="tabIconClass(tab)">
                        <AlertTriangle v-if="tab.externalSqlFileMissing" class="h-3.5 w-3.5" />
                        <Table2 v-else-if="tab.mode === 'data' || tab.mode === 'mongo' || tab.mode === 'redis' || tab.mode === 'hbase'" class="h-3.5 w-3.5" />
                        <DatabaseIcon v-else-if="tab.mode === 'mq'" :db-type="tabDatabaseIconType(tab)" class="h-3.5 w-3.5" />
                        <TableProperties v-else-if="tab.mode === 'vector'" class="h-3.5 w-3.5" />
                        <KeyRound v-else-if="tab.mode === 'etcd' || tab.mode === 'zookeeper' || tab.mode === 'consul'" class="h-3.5 w-3.5" />
                        <Gauge v-else-if="tab.mode === 'consul-overview'" class="h-3.5 w-3.5" />
                        <Gauge v-else-if="tab.mode === 'etcd-dashboard'" class="h-3.5 w-3.5" />
                        <ShieldCheck v-else-if="tab.mode === 'etcd-access-control'" class="h-3.5 w-3.5" />
                        <Network v-else-if="tab.mode === 'nacos'" class="h-3.5 w-3.5" />
                        <Database v-else-if="tab.mode === 'databases'" class="h-3.5 w-3.5" />
                        <TableProperties v-else-if="tab.mode === 'objects'" class="h-3.5 w-3.5" />
                        <PencilRuler v-else-if="tab.mode === 'structure'" class="h-3.5 w-3.5" />
                        <CalendarClock v-else-if="tab.mode === 'dameng-jobs'" class="h-3.5 w-3.5" />
                        <Activity v-else-if="tab.mode === 'processlist' || tab.mode === 'sqlserver-trace'" class="h-3.5 w-3.5" />
                        <Gauge v-else-if="tab.mode === 'mysql-dashboard' || tab.mode === 'postgres-dashboard' || tab.mode === 'nacos-dashboard'" class="h-3.5 w-3.5" />
                        <GitBranch v-else-if="tab.mode === 'dolt-version-control'" class="h-3.5 w-3.5" />
                        <Code2 v-else class="h-3.5 w-3.5" />
                      </span>
                    </TabExecutionStatus>
                    <input
                      v-if="editingTabId === tab.id"
                      v-model="editingTitle"
                      :data-tab-title-input="tab.id"
                      :aria-label="t('contextMenu.renameTab')"
                      class="h-5 min-w-0 flex-1 rounded border border-ring bg-background px-1.5 text-xs font-normal text-foreground outline-none"
                      @click.stop
                      @mousedown.stop
                      @keydown.enter.prevent="commitRenameTab(tab)"
                      @keydown.escape.prevent="cancelRenameTab"
                      @blur="commitRenameTab(tab)"
                    />
                    <span v-else class="inline-flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden text-foreground">
                      <span v-if="isDirtyTab(tab)" aria-hidden="true" class="dirty-tab-marker">*</span>
                      <span class="min-w-0 flex-1 truncate" :style="tabTitleStyle(tab)">{{ tabTitleText(tab) }}</span>
                    </span>
                    <ReadOnlySessionControl :connection-id="tab.connectionId" compact />
                    <button class="rounded p-0.5 text-primary hover:bg-muted-foreground/20 shrink-0" :aria-label="t('contextMenu.unfixTab')" :title="t('contextMenu.unfixTab')" @click.stop="queryStore.togglePinnedTab(tab.id)">
                      <Pin class="h-3 w-3 fill-current" aria-hidden="true" />
                    </button>
                    <button class="rounded hover:bg-muted-foreground/20 p-0.5 shrink-0" @click.stop="queryStore.closeTab(tab.id)">
                      <X class="h-3 w-3" />
                    </button>
                  </div>
                </TabBarTooltip>
              </div>
            </CustomContextMenu>
          </template>
          <div v-if="!isVerticalLayout" :class="fixedTabTailDragRegionClass" data-tauri-drag-region />
        </div>
        <div
          v-if="isVerticalLayout && hasFixedVerticalOverflow"
          ref="fixedVerticalScrollbarTrackRef"
          class="vertical-tab-scrollbar vertical-tab-scrollbar--fixed"
          :class="{
            'vertical-tab-scrollbar--scrolling': isFixedVerticalScrolling,
            'vertical-tab-scrollbar--dragging': isDraggingFixedVerticalScrollbar,
          }"
          @pointerdown="onFixedVerticalScrollbarTrackPointerDown"
        >
          <div ref="fixedVerticalScrollbarThumbRef" class="vertical-tab-scrollbar__thumb" @pointerdown.stop="onFixedVerticalScrollbarThumbPointerDown" />
        </div>
      </div>
      <div v-if="showFixedTabScrollbar" class="relative z-30 flex shrink-0 items-center">
        <Popover v-model:open="fixedTabOverflowOpen">
          <PopoverTrigger as-child>
            <button type="button" :class="['inline-flex shrink-0 items-center justify-center', tabOverflowControlClass].join(' ')" :aria-label="t('tabs.openTabs')" :title="t('tabs.openTabs')">
              <ChevronDown class="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" class="w-auto min-w-56 max-w-80 gap-0 rounded-[6px] p-1" @click.stop @keydown.stop>
            <div class="relative border-b px-1 pb-1">
              <Search class="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input data-tab-search-input="fixed" v-model="tabSearchQuery" type="search" :placeholder="t('tabs.searchOpenTabs')" class="h-8 pl-7 text-sm" />
            </div>
            <div class="max-h-[min(70vh,28rem)] overflow-y-auto pt-1">
              <CustomContextMenu v-for="tab in filteredOpenTabs" :key="tab.id" :items="getTabMenuItems(tab)" v-slot="{ onContextMenu }">
                <div
                  class="group flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm outline-hidden hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground"
                  :class="tab.id === queryStore.activeTabId && !driverStoreActive && !settingsPageActive ? 'bg-accent/70 text-accent-foreground' : ''"
                  :title="tabTitleLabel(tab)"
                  role="menuitem"
                  tabindex="0"
                  @click="activateTabFromOverflow(tab.id, 'fixed')"
                  @contextmenu="onContextMenu"
                  @keydown="onOverflowItemKeydown($event, tab.id, 'fixed')"
                >
                  <TabExecutionStatus :tab="tab">
                    <DatabaseIcon v-if="tab.mode === 'mq'" :db-type="tabDatabaseIconType(tab)" class="h-3.5 w-3.5 shrink-0" />
                    <component :is="tabMenuIcon(tab)" v-else :class="['h-3.5 w-3.5 shrink-0', tabIconClass(tab)]" />
                  </TabExecutionStatus>
                  <span class="inline-flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
                    <span v-if="isDirtyTab(tab)" aria-hidden="true" class="dirty-tab-marker">*</span>
                    <span class="min-w-0 flex-1 truncate" :style="tabTitleStyle(tab)">{{ tabTitleText(tab) }}</span>
                  </span>
                  <ReadOnlySessionControl :connection-id="tab.connectionId" compact />
                  <Pin v-if="tab.pinned" class="h-3 w-3 shrink-0 fill-current text-primary" />
                  <span class="w-5 shrink-0">
                    <button
                      type="button"
                      class="inline-flex rounded p-1 text-muted-foreground opacity-70 hover:bg-muted-foreground/20 hover:text-foreground group-hover:opacity-100"
                      :aria-label="t('contextMenu.closeTab')"
                      :title="t('contextMenu.closeTab')"
                      @click="closeTabFromOverflow(tab.id, $event)"
                      @mousedown.stop
                    >
                      <X class="h-3 w-3" />
                    </button>
                  </span>
                </div>
              </CustomContextMenu>
              <p v-if="filteredOpenTabs.length === 0" class="px-2 py-4 text-center text-sm text-muted-foreground">{{ t("tabs.noMatchingTabs") }}</p>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  </div>

  <Dialog
    :open="queryStore.showCloseConfirm"
    @update:open="
      (open) => {
        if (!open) queryStore.cancelClosePendingTab();
      }
    "
  >
    <DialogContent class="min-w-0 sm:max-w-md">
      <DialogHeader>
        <DialogTitle class="flex items-center gap-2">
          <AlertTriangle class="h-5 w-5 text-amber-500" />
          {{ t("editor.unsavedChangesTitle") }}
        </DialogTitle>
      </DialogHeader>
      <!-- Grid items use min-content sizing by default; shrink and wrap long file paths before they can displace the footer actions. -->
      <!-- 限制最大高度并允许滚动，确保内容超长时底部操作按钮始终可见可点-->
      <div class="max-h-120 min-h-0 min-w-0 overflow-y-auto space-y-2">
        <p class="wrap-anywhere text-sm text-muted-foreground">{{ closeConfirmMessage }}</p>
        <Popover v-if="showCloseConfirmBulkActions" :open="closeConfirmListOpen" @update:open="closeConfirmListOpen = $event">
          <PopoverTrigger as-child>
            <button
              type="button"
              class="inline-flex items-center text-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              @mouseenter="openCloseConfirmList"
              @mouseleave="scheduleCloseConfirmListClose"
            >
              {{ t("editor.unsavedChangesViewList", { count: closeConfirmDirtyCount }) }}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" side="bottom" class="w-72 max-w-[calc(100vw-2rem)] gap-1 p-2" @mouseenter="openCloseConfirmList" @mouseleave="scheduleCloseConfirmListClose" @pointerdown.stop @click.stop @keydown.stop>
            <div class="px-2 pb-1 text-xs font-medium text-muted-foreground">
              {{ t("editor.unsavedChangesListTitle", { count: closeConfirmDirtyCount }) }}
            </div>
            <div class="max-h-48 overflow-y-auto">
              <div v-for="tab in closeConfirmDirtyTabs" :key="tab.id" class="flex min-w-0 items-center gap-2 rounded-[6px] px-2 py-1.5 text-sm" :class="tab.id === queryStore.pendingCloseTabId ? 'bg-muted text-foreground' : 'text-muted-foreground'">
                <span class="h-1.5 w-1.5 shrink-0 rounded-full" :class="tab.id === queryStore.pendingCloseTabId ? 'bg-foreground' : 'bg-muted-foreground/50'" />
                <span class="min-w-0 truncate">{{ tabDisplayTitle(tab, t) }}</span>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>
      <DialogFooter class="min-w-0 sm:flex-wrap">
        <Button variant="outline" @click="handleCancelClose">{{ t("common.cancel") }}</Button>
        <Button v-if="showCloseConfirmBulkActions" variant="secondary" class="border-border" @click="handleDiscardAllAndClose">{{ t("editor.discardAllChanges") }}</Button>
        <Button v-if="showCloseConfirmBulkActions" @click="handleSaveAllAndClose">{{ t("editor.saveAllChanges") }}</Button>
        <Button variant="secondary" class="border-border" @click="handleDiscardAndClose">{{ t("editor.discardChanges") }}</Button>
        <Button @click="handleSaveAndClose">{{ t("savedSql.save") }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<style scoped>
/* 多行平铺模式：覆盖滚动相关样式，让标签换行展示 */
.app-tab-scroll.wrap-mode {
  height: auto !important;
  overflow: visible !important;
  overflow-x: visible !important;
  overflow-y: visible !important;
  flex-wrap: wrap;
  align-content: flex-start;
  justify-content: flex-start;
}

.vertical-tab-layout {
  flex: 0 0 15rem;
  min-height: 0;
  max-height: 100%;
}

.vertical-tab-layout > .connection-tree-search {
  overflow: visible;
}

.vertical-tab-layout .vertical-tab-row--regular {
  flex: 1 1 0%;
  min-height: 0;
}

.vertical-tab-layout .vertical-tab-row--fixed {
  flex: 0 1 auto;
  max-height: 40%;
  min-height: 0;
}

.vertical-tab-layout .app-tab-strip {
  display: flex;
  flex-direction: column;
  flex: 1 1 0%;
  min-height: 0;
  width: 100%;
  overflow: hidden;
}

.vertical-tab-layout .vertical-tab-scroller {
  flex: 1 1 0%;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.vertical-tab-layout .vertical-tab-scroller::-webkit-scrollbar {
  width: 0;
  height: 0;
}

.vertical-tab-layout .app-tab-pill {
  width: 100%;
  min-width: 0 !important;
  min-height: 2rem;
  height: 2rem !important;
  border-right: 0;
}

.vertical-tab-layout .vertical-tab-scroller > .tab-group-section,
.vertical-tab-layout .vertical-tab-scroller > :not(.tab-group-section) {
  width: 100%;
}

.tab-group-section--vertical {
  display: block;
  width: 100%;
  gap: 0;
}

.vertical-tab-layout .tab-group-section--vertical > :not(.tab-group-header) {
  display: block;
  width: 100%;
}

.tab-group-section--inline {
  display: inline-flex;
  flex-direction: row;
  flex-wrap: nowrap;
  align-items: center;
  flex-shrink: 0;
  gap: 0.375rem;
  max-width: 100%;
}

.tab-group-section--inline:not(:first-child) {
  margin-left: 0.25rem;
  padding-left: 0.375rem;
  border-left: 1px solid color-mix(in oklch, var(--border) 60%, transparent);
}

.tab-group-section--inline .tab-group-header {
  margin-left: 0;
  border-left: 0;
  padding-left: 0;
  max-width: 9rem;
}

.vertical-tab-layout .tab-group-header {
  width: 100%;
  min-height: 1.75rem;
  padding: 0.5rem 0.625rem;
  color: var(--muted-foreground);
  font-size: 0.75rem;
  font-weight: 600;
  line-height: 1rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-radius: 0.25rem;
}

.vertical-tab-layout .tab-group-header:hover {
  background: color-mix(in oklch, var(--foreground) 6%, transparent);
}

.tab-group-header {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  flex-shrink: 0;
  border: 0;
  background: transparent;
  padding: 0;
  cursor: pointer;
  font-size: 0.75rem;
  font-weight: 600;
  line-height: 1;
  color: var(--muted-foreground);
}

.tab-group-header:hover {
  color: var(--foreground);
}

.tab-group-header--collapsed:not(.tab-group-header--vertical) {
  opacity: 0.82;
}

.tab-group-section--inline .tab-group-header {
  align-self: stretch;
  min-height: 1.75rem;
  padding: 0 0.375rem;
  border-radius: 0.25rem;
}

.tab-group-section--inline .tab-group-header:hover {
  background: color-mix(in oklch, var(--foreground) 6%, transparent);
}

.app-tab-bar--classic-horizontal .tab-group-section--inline .tab-group-header {
  height: 100%;
}

.app-tab-scroll.wrap-mode .tab-group-section--inline {
  display: contents;
}

.app-tab-scroll.wrap-mode .tab-group-section--inline > * {
  flex-shrink: 0;
}

.app-tab-scroll.wrap-mode .tab-group-header:not(:first-of-type) {
  margin-left: 0.25rem;
  padding-left: 0.375rem;
  border-left: 1px solid color-mix(in oklch, var(--border) 60%, transparent);
}

/* 父级 strip 容器在包含 wrap-mode 时也需要解除高度约束和裁剪 */
.app-tab-strip:has(.wrap-mode) {
  height: auto !important;
  overflow: visible !important;
}

/* 标签栏行容器（直接子 div）在包含 wrap-mode 时解除固定高度和裁剪 */
.app-tab-bar > div:has(.wrap-mode) {
  height: auto !important;
  overflow: visible !important;
}

/* 横向换行时让标签栏随内容自然增高，不限制高度、不出现纵向滚动条 */
.app-tab-bar:has(.wrap-mode):not(.vertical-tab-layout) {
  overflow: visible !important;
}

/* 经典布局 + 多行模式：优化多行标签显示 */
.app-tab-scroll.classic-wrap {
  row-gap: 0.25rem;
  padding-top: 0.25rem;
  padding-bottom: 0.25rem;
  align-items: flex-start;
}

/* 经典布局下 h-full 在 height:auto 容器中失效，改为固定高度 */
.app-tab-scroll.classic-wrap > div,
.app-tab-scroll.classic-wrap .app-tab-pill,
.app-tab-scroll.classic-wrap .tab-group-header {
  height: 2rem;
}

.app-tab-pill {
  background-color: var(--app-tab-background);
}

.app-tab-pill[data-active-tab="false"]:hover {
  background-color: var(--app-tab-hover-background, color-mix(in oklch, var(--foreground) 8%, transparent));
}

.dirty-tab-marker {
  display: inline-flex;
  width: 0.5rem;
  height: 0.75rem;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  color: currentColor;
  font-size: 13px;
  font-weight: 700;
  line-height: 12px;
  opacity: 0.9;
  transform: translateY(2px);
}

.app-tab-scroll::-webkit-scrollbar {
  display: none;
}

.vertical-tab-scrollbar {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 10;
  width: 12px;
  cursor: default;
  opacity: 0;
  transition: opacity 120ms ease;
}

.vertical-tab-scrollbar--scrolling,
.vertical-tab-scrollbar:hover,
.vertical-tab-scrollbar--dragging {
  opacity: 1;
}

.vertical-tab-scrollbar--scrolling .vertical-tab-scrollbar__thumb,
.vertical-tab-scrollbar--dragging .vertical-tab-scrollbar__thumb {
  will-change: transform;
}

.vertical-tab-scrollbar__thumb {
  position: absolute;
  right: 2px;
  width: 6px;
  min-height: 24px;
  border-radius: 999px;
  background: color-mix(in oklch, var(--foreground) 30%, transparent);
  transition:
    background-color 120ms ease,
    width 120ms ease,
    right 120ms ease;
}

.vertical-tab-scrollbar:hover .vertical-tab-scrollbar__thumb,
.vertical-tab-scrollbar--dragging .vertical-tab-scrollbar__thumb {
  right: 1px;
  width: 8px;
  background: color-mix(in oklch, var(--foreground) 48%, transparent);
}

.app-tab-scrollbar {
  position: absolute;
  inset-inline: 0;
  top: 0;
  z-index: 20;
  height: 6px;
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  touch-action: none;
  transition: opacity 140ms ease;
}

.app-tab-strip:hover .app-tab-scrollbar,
.app-tab-strip:focus-within .app-tab-scrollbar,
.app-tab-scrollbar--dragging {
  opacity: 1;
  pointer-events: auto;
}

.app-tab-scrollbar::before {
  content: "";
  position: absolute;
  inset-inline: 0;
  top: 0;
  height: 2px;
  border-radius: 999px;
  background: color-mix(in oklch, var(--foreground) 8%, transparent);
}

.app-tab-scrollbar--bottom {
  top: auto;
  bottom: 0;
}

.app-tab-scrollbar--bottom::before {
  top: auto;
  bottom: 0;
}

.app-tab-scrollbar__thumb {
  position: absolute;
  top: 0;
  height: 2px;
  min-width: 20px;
  border-radius: 999px;
  background: color-mix(in oklch, var(--foreground) 30%, transparent);
  transition:
    height 120ms ease,
    background-color 120ms ease;
}

.app-tab-scrollbar--bottom .app-tab-scrollbar__thumb {
  top: auto;
  bottom: 0;
}

.app-tab-scrollbar:hover .app-tab-scrollbar__thumb,
.app-tab-scrollbar--dragging .app-tab-scrollbar__thumb {
  height: 5px;
  background: color-mix(in oklch, var(--foreground) 52%, transparent);
}
</style>
