// =====================================================
// PUSH SETUP — Android notification channels + foreground handler
// The server pipeline (supabase/functions/push-notifications)
// sends channelId 'health-alerts' / 'report-updates' / 'default'.
// On Android 8+ a push posted to a never-created channel is
// silently dropped, so these channels must exist before the
// first push arrives. Also installs a foreground notification
// handler so pushes received while the app is open are shown.
//
// Every call is guarded: on web, in Expo Go, or when the native
// module is missing this resolves silently and never crashes.
// =====================================================
import { Platform } from 'react-native';

let setupDone = false;

export async function setupPushChannelsAndHandler(): Promise<void> {
  if (setupDone) return;
  if (Platform.OS === 'web') return;

  const Notifications = await import('expo-notifications').catch(() => null);
  if (!Notifications) return;

  setupDone = true;

  // Foreground handler — without one, a push received while the app is
  // open displays nothing. Sound is reserved for the health-alerts channel.
  try {
    Notifications.setNotificationHandler({
      handleNotification: async (notification) => {
        const data = (notification?.request?.content?.data ?? {}) as Record<string, unknown>;
        const channelId = (notification?.request?.trigger as { channelId?: string } | null)
          ?.channelId;
        const isHealthAlert =
          channelId === 'health-alerts' || data.triggerType === 'alert_created';
        return {
          shouldShowAlert: true, // deprecated alias, kept for older runtimes
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: isHealthAlert,
          shouldSetBadge: false,
        };
      },
    });
  } catch {
    console.log('[Push] Foreground notification handler unavailable on this runtime.');
  }

  if (Platform.OS !== 'android') return;

  const { AndroidImportance } = Notifications;

  await Notifications.setNotificationChannelAsync('health-alerts', {
    name: 'Health alerts',
    description: 'Urgent disease outbreak and water safety alerts',
    importance: AndroidImportance.MAX,
    sound: 'default',
    vibrationPattern: [0, 250, 250, 250],
    enableVibrate: true,
  }).catch(() => {
    console.log('[Push] Could not create health-alerts channel.');
  });

  await Notifications.setNotificationChannelAsync('report-updates', {
    name: 'Report updates',
    description: 'Status updates on reports you submitted',
    importance: AndroidImportance.DEFAULT,
  }).catch(() => {
    console.log('[Push] Could not create report-updates channel.');
  });

  await Notifications.setNotificationChannelAsync('default', {
    name: 'General',
    importance: AndroidImportance.DEFAULT,
  }).catch(() => {
    console.log('[Push] Could not create default channel.');
  });
}
