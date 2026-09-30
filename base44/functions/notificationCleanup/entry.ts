import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

const BATCH_SIZE = 500;
const MAX_BATCHES = 20;
const DEFAULT_RETENTION_DAYS = 30;

/**
 * Notification Cleanup — deletes notifications older than the configured
 * retention period (TradingPreferences.notification_retention_days).
 *
 * Runs nightly from the "Notification Cleanup" workflow, and can be invoked
 * directly from the notifications panel via { run_now: true } so a changed
 * retention takes effect immediately.
 */
export default async function (req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);

    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const preferencesResult = await base44.asServiceRole.entities.TradingPreferences.list();
    const preferences = Array.isArray(preferencesResult)
      ? preferencesResult
      : preferencesResult?.items || [];

    const configuredDays = preferences
      .map((preference) => preference.notification_retention_days)
      .filter((days) => typeof days === 'number' && days > 0);

    if (configuredDays.length === 0) {
      return Response.json({ success: true, deleted: 0, message: 'Retention is set to keep notifications' });
    }

    // Notifications are app-level (created by the trading worker, not tied to a
    // single user), so one date cutoff is applied. The longest configured
    // retention wins, so no user's history is deleted earlier than they asked.
    const retentionDays = Math.max(...configuredDays);
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

    let deleted = 0;

    for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
      const page = await base44.asServiceRole.entities.Notification.filter(
        { created_date: { $lt: cutoff } },
        { sort: '-created_date', limit: BATCH_SIZE, fields: ['id'] }
      );
      const items = Array.isArray(page) ? page : page?.items || [];

      if (items.length === 0) break;

      const result = await base44.asServiceRole.entities.Notification.deleteMany({
        id: { $in: items.map((notification) => notification.id) },
      });

      const removed = result?.deleted || 0;
      if (removed === 0) break;

      deleted += removed;

      if (items.length < BATCH_SIZE) break;
    }

    console.log(`🧹 Notification Cleanup: removed ${deleted} notification(s) older than ${retentionDays} days`);

    return Response.json({ success: true, deleted, retention_days: retentionDays, cutoff });
  } catch (error) {
    return Response.json({ success: false, error: error.message }, { status: 500 });
  }
}