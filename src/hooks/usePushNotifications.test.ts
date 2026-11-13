import { describe, it, expect, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { usePushNotifications, isDuplicateNotification } from "./usePushNotifications";

describe("local notification dedupe", () => {
  beforeEach(() => localStorage.clear());

  it("raises an alert once and drops an identical one inside 24h", () => {
    const { result } = renderHook(() => usePushNotifications());
    expect(result.current.sendLocalNotification("Quest Overdue", "Ship it", "motivational")).toBe(true);
    expect(result.current.sendLocalNotification("Quest Overdue", "Ship it", "motivational")).toBe(false);
    expect(result.current.getNotifications()).toHaveLength(1);
  });

  it("keeps distinct alerts", () => {
    const { result } = renderHook(() => usePushNotifications());
    result.current.sendLocalNotification("Quest Overdue", "Ship it");
    expect(result.current.sendLocalNotification("Quest Overdue", "Write it")).toBe(true);
    expect(result.current.getNotifications()).toHaveLength(2);
  });

  it("allows the same alert again after the window", () => {
    localStorage.setItem("mavis_notifications", JSON.stringify([{ id: "1", title: "T", body: "B", timestamp: Date.now() - 25 * 3600e3, read: true }]));
    expect(isDuplicateNotification("T", "B")).toBe(false);
    expect(isDuplicateNotification("T", "B", 48 * 3600e3)).toBe(true);
  });
});
