import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Trash2 } from "lucide-react";

const DEFAULT_RETENTION_DAYS = 30;

const RETENTION_OPTIONS = [
  { value: '0', label: 'Keep everything' },
  { value: '7', label: 'Clear after 7 days' },
  { value: '30', label: 'Clear after 30 days' },
  { value: '90', label: 'Clear after 90 days' },
];

export default function NotificationRetentionSelect() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState(null);

  const { data: preferences = [] } = useQuery({
    queryKey: ['trading-preferences'],
    queryFn: async () => {
      const result = await base44.entities.TradingPreferences.list();
      return Array.isArray(result) ? result : result?.items || [];
    },
  });

  const preference = preferences[0];
  const retentionDays = typeof preference?.notification_retention_days === 'number'
    ? preference.notification_retention_days
    : DEFAULT_RETENTION_DAYS;

  const saveMutation = useMutation({
    mutationFn: async (days) => {
      if (preference?.id) {
        await base44.entities.TradingPreferences.update(preference.id, {
          notification_retention_days: days,
        });
      } else {
        await base44.entities.TradingPreferences.create({
          trading_style: 'balanced',
          risk_tolerance: 'moderate',
          notification_retention_days: days,
        });
      }

      // Run the cleanup right away so a change is visible now, not tomorrow night.
      const response = await base44.functions.invoke('notificationCleanup', {});
      return response?.data?.deleted || 0;
    },
    onSuccess: (deleted) => {
      queryClient.invalidateQueries({ queryKey: ['trading-preferences'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      setStatus(deleted > 0
        ? `Removed ${deleted.toLocaleString()} old notification${deleted === 1 ? '' : 's'}`
        : 'Nothing older than that to remove');
    },
    onError: (error) => {
      console.error('Failed to update notification auto-clean:', error);
      setStatus('Could not update auto-clean');
    },
  });

  return (
    <div className="mt-3 pt-3 border-t border-slate-800">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-xs text-slate-400">
          <Trash2 className="w-3.5 h-3.5" />
          Auto-clean
        </span>
        <Select
          value={String(retentionDays)}
          onValueChange={(value) => saveMutation.mutate(Number(value))}
          disabled={saveMutation.isPending}
        >
          <SelectTrigger className="h-8 w-[170px] bg-slate-800 border-slate-700 text-slate-200 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-slate-900 border-slate-700">
            {RETENTION_OPTIONS.map((option) => (
              <SelectItem
                key={option.value}
                value={option.value}
                className="text-slate-200 text-xs focus:bg-slate-800 focus:text-white"
              >
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p className="text-[11px] text-slate-500 mt-1.5">
        {saveMutation.isPending
          ? 'Removing old notifications…'
          : status || 'Old notifications are cleared automatically every night.'}
      </p>
    </div>
  );
}