import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Bell,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  XCircle,
  Wifi,
  Sparkles,
  AlertTriangle,
  Check,
  Trash2,
  X
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function NotificationCenter() {
  const [isOpen, setIsOpen] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => base44.entities.Notification.list('-created_date', 50),
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  // Every bulk action is one request. The old version fired a write per notification
  // (dozens in parallel for "Mark all read", dozens in sequence for "Clear all"),
  // which tripped the app's request rate limit — most writes failed and were only
  // logged, so the panel appeared to ignore the click.
  const markAsReadMutation = useMutation({
    mutationFn: (ids) => base44.entities.Notification.updateMany(
      { id: { $in: ids } },
      { $set: { is_read: true } }
    ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (error) => {
      console.error('Failed to mark notifications as read:', error);
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const deleteNotificationMutation = useMutation({
    mutationFn: (id) => base44.entities.Notification.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (error) => {
      console.error('Failed to delete notification:', error);
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  // Clears the whole inbox, not just the page on screen, in a single request.
  const clearAllMutation = useMutation({
    mutationFn: () => base44.entities.Notification.deleteMany({}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (error) => {
      console.error('Failed to clear notifications:', error);
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const unreadCount = notifications.filter(n => !n.is_read).length;

  const handleMarkAsRead = (notification) => {
    if (notification.is_read) return;

    markAsReadMutation.mutate([notification.id]);
  };

  const handleMarkAllAsRead = () => {
    const unreadIds = notifications.filter(n => !n.is_read).map(n => n.id);

    if (unreadIds.length === 0) return;

    markAsReadMutation.mutate(unreadIds);
  };

  const handleDelete = (e, id) => {
    e.stopPropagation(); // Prevent triggering the markAsRead on the parent div
    deleteNotificationMutation.mutate(id);
  };

  const handleClearAll = () => {
    setConfirmClearOpen(true);
  };

  const handleConfirmClearAll = () => {
    clearAllMutation.mutate();
  };

  const getNotificationIcon = (type, priority) => {
    const iconProps = { className: "w-5 h-5" };
    
    switch (type) {
      case 'price_alert':
        return priority === 'high' || priority === 'urgent' 
          ? <TrendingUp {...iconProps} className="w-5 h-5 text-green-400" />
          : <TrendingDown {...iconProps} className="w-5 h-5 text-red-400" />;
      case 'order_filled':
        return <CheckCircle2 {...iconProps} className="w-5 h-5 text-green-400" />;
      case 'order_cancelled':
        return <XCircle {...iconProps} className="w-5 h-5 text-red-400" />;
      case 'connection_status':
        return <Wifi {...iconProps} className="w-5 h-5 text-blue-400" />;
      case 'ai_anomaly':
        return <Sparkles {...iconProps} className="w-5 h-5 text-purple-400" />;
      default:
        return <AlertTriangle {...iconProps} className="w-5 h-5 text-yellow-400" />;
    }
  };

  const getPriorityColor = (priority) => {
    switch (priority) {
      case 'urgent':
        return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'high':
        return 'bg-orange-500/20 text-orange-400 border-orange-500/30';
      case 'medium':
        return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'low':
        return 'bg-slate-500/20 text-slate-400 border-slate-500/30';
      default:
        return 'bg-slate-500/20 text-slate-400 border-slate-500/30';
    }
  };

  const getTimeAgo = (date) => {
    const seconds = Math.floor((new Date() - new Date(date)) / 1000);
    
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="w-5 h-5 text-slate-300" />
          {unreadCount > 0 && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-xs font-bold rounded-full flex items-center justify-center"
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </motion.span>
          )}
        </Button>
      </SheetTrigger>
      
      <SheetContent className="bg-slate-900 border-slate-700 w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="text-white flex items-center justify-between">
            <span>Notifications</span>
            <div className="flex gap-2">
              {unreadCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleMarkAllAsRead}
                  disabled={markAsReadMutation.isPending}
                  className="text-indigo-400 hover:text-indigo-300 hover:bg-indigo-500/10"
                >
                  <Check className="w-4 h-4 mr-1" />
                  Mark all read
                </Button>
              )}
              {notifications.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearAll}
                  disabled={clearAllMutation.isPending}
                  className="text-red-400 hover:text-red-300 hover:bg-red-500/10"
                >
                  <Trash2 className="w-4 h-4 mr-1" />
                  {clearAllMutation.isPending ? 'Clearing…' : 'Clear all'}
                </Button>
              )}
            </div>
          </SheetTitle>
        </SheetHeader>

        <ScrollArea className="h-[calc(100vh-100px)] mt-6 pr-4">
          {notifications.length === 0 ? (
            <div className="text-center py-12">
              <Bell className="w-12 h-12 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400">No notifications yet</p>
              <p className="text-slate-500 text-sm mt-1">
                You'll see alerts and updates here
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <AnimatePresence>
                {notifications.map((notification) => (
                  <motion.div
                    key={notification.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className={`p-4 rounded-xl border transition-all cursor-pointer group relative ${
                      notification.is_read
                        ? 'bg-slate-800/50 border-slate-700'
                        : 'bg-slate-800 border-indigo-500/30'
                    }`}
                    onClick={() => handleMarkAsRead(notification)}
                  >
                    {!notification.is_read && (
                      <div className="absolute left-2 top-1/2 -translate-y-1/2 w-2 h-2 bg-indigo-500 rounded-full"></div>
                    )}

                    <div className="flex gap-3">
                      <div className="flex-shrink-0 mt-1">
                        {getNotificationIcon(notification.notification_type, notification.priority)}
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <h4 className="font-semibold text-white text-sm flex-1">
                            {notification.title}
                          </h4>
                          <div className="flex items-center gap-2">
                            <Badge className={`text-xs ${getPriorityColor(notification.priority)}`}>
                              {notification.priority}
                            </Badge>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 hover:bg-red-500/20 flex-shrink-0"
                              onClick={(e) => handleDelete(e, notification.id)}
                              title="Delete notification"
                            >
                              <X className="w-3.5 h-3.5 text-slate-400 hover:text-red-400" />
                            </Button>
                          </div>
                        </div>
                        
                        <p className="text-sm text-slate-300 mb-2 line-clamp-2">
                          {notification.message}
                        </p>
                        
                        {notification.data && (
                          <div className="text-xs text-slate-400 space-y-1 mb-2">
                            {notification.data.asset && (
                              <div>Asset: <span className="text-white font-semibold">{notification.data.asset}</span></div>
                            )}
                            {notification.data.price && (
                              <div>Price: <span className="text-white font-semibold">${notification.data.price.toLocaleString()}</span></div>
                            )}
                            {notification.data.change && (
                              <div className={notification.data.change >= 0 ? 'text-green-400' : 'text-red-400'}>
                                Change: {notification.data.change >= 0 ? '+' : ''}{notification.data.change.toFixed(2)}%
                              </div>
                            )}
                          </div>
                        )}
                        
                        <span className="text-xs text-slate-500">
                          {getTimeAgo(notification.created_date)}
                        </span>
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </ScrollArea>

        {/* In-app confirmation: window.confirm is blocked inside the preview iframe,
            so the previous Clear all button silently did nothing. */}
        <AlertDialog open={confirmClearOpen} onOpenChange={setConfirmClearOpen}>
          <AlertDialogContent className="bg-slate-900 border-slate-700">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-white">Clear all notifications?</AlertDialogTitle>
              <AlertDialogDescription className="text-slate-400">
                This permanently deletes every notification in your inbox, including the older ones
                not currently shown. It cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700 hover:text-white">
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirmClearAll}
                disabled={clearAllMutation.isPending}
                className="bg-red-600 hover:bg-red-500 text-white"
              >
                {clearAllMutation.isPending ? 'Clearing…' : 'Delete all'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SheetContent>
    </Sheet>
  );
}