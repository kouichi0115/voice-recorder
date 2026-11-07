import { describe, expect, it } from "vitest";
import {
  elapsedToEpoch,
  formatClock,
  formatDurationJa,
  formatElapsed,
  formatElapsedLong,
  formatSrtTime,
  timestampFormatter,
} from "../src/lib/time";

describe("time formatting", () => {
  it("formats elapsed seconds", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(65.9)).toBe("01:05");
    expect(formatElapsed(3725)).toBe("1:02:05");
    expect(formatElapsed(-3)).toBe("00:00");
    expect(formatElapsedLong(65)).toBe("00:01:05");
    expect(formatElapsedLong(36000)).toBe("10:00:00");
  });

  it("formats SRT times with milliseconds", () => {
    expect(formatSrtTime(0)).toBe("00:00:00,000");
    expect(formatSrtTime(3725.4567)).toBe("01:02:05,457");
  });

  it("formats durations in Japanese", () => {
    expect(formatDurationJa(42)).toBe("42秒");
    expect(formatDurationJa(125)).toBe("2分5秒");
    expect(formatDurationJa(3725)).toBe("1時間2分5秒");
  });

  it("adds paused time back when converting to wall-clock time", () => {
    const start = new Date(2026, 10, 7, 14, 0, 0).getTime();
    const pauses = [{ at: 60, ms: 30_000 }];
    expect(elapsedToEpoch(start, 30, pauses)).toBe(start + 30_000);
    expect(elapsedToEpoch(start, 90, pauses)).toBe(start + 120_000);
    expect(formatClock(elapsedToEpoch(start, 90, pauses))).toBe("14:02:00");
  });

  it("picks a formatter for the display mode", () => {
    const start = new Date(2026, 10, 7, 9, 5, 0).getTime();
    expect(timestampFormatter("elapsed", start, [])(75)).toBe("01:15");
    expect(timestampFormatter("elapsed", start, [], true)(75)).toBe("00:01:15");
    expect(timestampFormatter("clock", start, [])(75)).toBe("09:06:15");
  });
});
