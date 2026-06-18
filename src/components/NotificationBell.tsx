import { useState, useEffect } from "react";
import { Bell } from "lucide-react";
import { usePushNotifications, type LocalNotification } from "@/hooks/usePushNotifications";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export function NotificationBell() {
  const { getNotifications, markAllRead, requestPermission, permission } = usePushNotifications();
  const [notifications, setNotifications] = useState<LocalNotification[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setNotifications(getNotifications());
  }, [open]);

  const unread = notifications.filter(n => !n.read).length;

  const handleOpen = async (isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen) {
      if (permission === "default") {
        await requestPermission();
      }
      setNotifications(getNotifications());
      setTimeout(() => {
        markAllRead();
        setNotifications(prev => prev.map(n => ({ ...n, read: true })));
      }, 500);
    }
  };

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-8 w-8">
          <Bell size={16} className="text-muted-foreground" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-neon-gold text-[9px] font-bold text-black">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0 bg-[#0d0d0d] border-white/10" align="end">
        <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
          <span className="text-xs font-mono font-semibold text-white/70">MAVIS ALERTS</span>
          <span className="text-[10px] text-white/30">{notifications.length} total</span>
        </div>
        <div className="max-h-72 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-white/30 font-mono">
              No alerts. All systems nominal.
            </div>
          ) : (
            notifications.slice(0, 20).map(n => (
              <div
                key={n.id}
                className={`px-3 py-2 border-b border-white/5 ${n.read ? "opacity-50" : ""}`}
              >
                <div className="text-xs font-semibold text-white/80">{n.title}</div>
                <div className="text-[11px] text-white/50 mt-0.5">{n.body}</div>
                <div className="text-[10px] text-white/20 mt-0.5">
                  {new Date(n.timestamp).toLocaleString()}
                </div>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
