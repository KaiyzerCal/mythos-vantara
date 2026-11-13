import { useState } from "react";

export interface LocalNotification {
  id: string;
  title: string;
  body: string;
  timestamp: number;
  read: boolean;
  type?: string;
}

const STORAGE_KEY = "mavis_notifications";

function loadNotifications(): LocalNotification[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch { return []; }
}

function saveNotifications(notifications: LocalNotification[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(notifications.slice(0, 50)));
}

const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** True when an identical alert (same title + body) was already raised inside the window. */
export function isDuplicateNotification(title: string, body: string, windowMs = DEDUPE_WINDOW_MS): boolean {
  const now = Date.now();
  return loadNotifications().some((n) => n.title === title && n.body === body && now - n.timestamp < windowMs);
}

export function usePushNotifications() {
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification !== "undefined" ? Notification.permission : "denied"
  );

  const requestPermission = async (): Promise<NotificationPermission> => {
    if (typeof Notification === "undefined") return "denied";
    const result = await Notification.requestPermission();
    setPermission(result);
    return result;
  };

  // Returns false (and shows nothing) when the same alert was already raised in the last 24h. Without this every
  // new session re-announced the same overdue quest, and two tabs opened together each announced it.
  const sendLocalNotification = (title: string, body: string, type?: string): boolean => {
    if (isDuplicateNotification(title, body)) return false;
    const notification: LocalNotification = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      title,
      body,
      timestamp: Date.now(),
      read: false,
      type,
    };
    const existing = loadNotifications();
    saveNotifications([notification, ...existing]);

    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      // `tag` makes the OS replace an identical notification instead of stacking a second one.
      new Notification(title, { body, icon: "/favicon.ico", badge: "/favicon.ico", tag: `${type ?? "mavis"}:${title}:${body}` });
    }
    return true;
  };

  const getNotifications = (): LocalNotification[] => loadNotifications();

  const markAllRead = () => {
    const notifications = loadNotifications().map(n => ({ ...n, read: true }));
    saveNotifications(notifications);
  };

  const unreadCount = (): number => loadNotifications().filter(n => !n.read).length;

  return { permission, requestPermission, sendLocalNotification, getNotifications, markAllRead, unreadCount };
}
