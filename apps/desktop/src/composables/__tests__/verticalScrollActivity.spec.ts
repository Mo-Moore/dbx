import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVerticalScrollActivity, VERTICAL_SCROLL_ACTIVITY_CLEAR_MS } from "@/composables/verticalScrollActivity";

describe("createVerticalScrollActivity", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("marks scrolling and clears after the delay", () => {
    const activity = createVerticalScrollActivity();
    expect(activity.isScrolling.value).toBe(false);

    activity.markScrolling();
    expect(activity.isScrolling.value).toBe(true);

    vi.advanceTimersByTime(VERTICAL_SCROLL_ACTIVITY_CLEAR_MS - 1);
    expect(activity.isScrolling.value).toBe(true);

    vi.advanceTimersByTime(1);
    expect(activity.isScrolling.value).toBe(false);
  });

  it("renews the clear timer on repeated markScrolling calls", () => {
    const activity = createVerticalScrollActivity();
    activity.markScrolling();

    vi.advanceTimersByTime(VERTICAL_SCROLL_ACTIVITY_CLEAR_MS - 100);
    activity.markScrolling();

    vi.advanceTimersByTime(VERTICAL_SCROLL_ACTIVITY_CLEAR_MS - 1);
    expect(activity.isScrolling.value).toBe(true);

    vi.advanceTimersByTime(1);
    expect(activity.isScrolling.value).toBe(false);
  });

  it("clears scrolling after a thumb-style mark without any scroll follow-up", () => {
    // Simulates scrollbar thumb pointerdown + pointerup with no scroll event:
    // both call markScrolling; the flag must still clear after the delay.
    const activity = createVerticalScrollActivity();
    activity.markScrolling(); // pointerdown
    activity.markScrolling(); // pointerup / stopDrag

    expect(activity.isScrolling.value).toBe(true);
    vi.advanceTimersByTime(VERTICAL_SCROLL_ACTIVITY_CLEAR_MS);
    expect(activity.isScrolling.value).toBe(false);
  });

  it("dispose clears the flag and cancels the pending timer", () => {
    const activity = createVerticalScrollActivity();
    activity.markScrolling();
    activity.dispose();

    expect(activity.isScrolling.value).toBe(false);
    vi.advanceTimersByTime(VERTICAL_SCROLL_ACTIVITY_CLEAR_MS);
    expect(activity.isScrolling.value).toBe(false);
  });
});
