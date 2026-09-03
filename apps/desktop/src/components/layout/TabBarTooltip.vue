<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import LightTooltip from "@/components/ui/LightTooltip.vue";
import { tabTooltipLines } from "@/lib/tabs/tabPresentation";
import type { QueryTab } from "@/types/database";

const props = withDefaults(
  defineProps<{
    tab: QueryTab;
    disabled?: boolean;
    delay?: number;
    side?: "top" | "right" | "bottom" | "left";
  }>(),
  {
    disabled: false,
    delay: 300,
    side: "bottom",
  },
);

const { t } = useI18n();
const lines = computed(() => tabTooltipLines(props.tab, t));
</script>

<template>
  <LightTooltip text="" :side="side" :side-offset="8" surface="popover" :disabled="disabled" :delay="delay">
    <slot />
    <template #content>
      <div class="w-max min-w-40 max-w-[min(28rem,calc(100vw-24px))] rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-lg">
        <div class="space-y-1">
          <div v-for="line in lines" :key="line.label" class="grid grid-cols-[max-content_minmax(0,1fr)] gap-2 text-xs leading-5">
            <span class="text-muted-foreground shrink-0">{{ line.label }}</span>
            <span class="truncate font-mono text-foreground/90" :title="line.value">{{ line.value }}</span>
          </div>
        </div>
      </div>
    </template>
  </LightTooltip>
</template>
