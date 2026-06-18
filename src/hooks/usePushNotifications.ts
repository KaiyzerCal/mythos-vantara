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

  const sendLocalNotification = (title: string, body: string, type?: string) => {
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
      new Notification(title, { body, icon: "/favicon.ico", badge: "/favicon.ico" });
    }
  };

  const getNotifications = (): LocalNotification[] => loadNotifications();

  const markAllRead = () => {
    const notifications = loadNotifications().map(n => ({ ...n, read: true }));
    saveNotifications(notifications);
  };

  const unreadCount = (): number => loadNotifications().filter(n => !n.read).length;

  return { permission, requestPermission, sendLocalNotification, getNotifications, markAllRead, unreadCount };
}
