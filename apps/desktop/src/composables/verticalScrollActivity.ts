import { ref, type Ref } from "vue";

export const VERTICAL_SCROLL_ACTIVITY_CLEAR_MS = 700;

/** Tracks short-lived "user is scrolling" state so tooltips can stay suppressed. */
export function createVerticalScrollActivity(clearDelayMs = VERTICAL_SCROLL_ACTIVITY_CLEAR_MS): {
  isScrolling: Ref<boolean>;
  markScrolling: () => void;
  dispose: () => void;
} {
  const isScrolling = ref(false);
  let timer: ReturnType<typeof setTimeout> | null = null;

  function markScrolling() {
    isScrolling.value = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      isScrolling.value = false;
      timer = null;
    }, clearDelayMs);
  }

  function dispose() {
    if (timer) clearTimeout(timer);
    timer = null;
    isScrolling.value = false;
  }

  return { isScrolling, markScrolling, dispose };
}
