import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useAttendanceTracking } from '../context/AttendanceTrackingContext';
import { colors, radius, shadow } from '../theme';
import { formatDuration } from '../utils/duration';

// Attendance is fully automatic: AttendanceTrackingContext runs a background
// location watch for the whole app and times the employee in the moment
// they enter this event's geofence, then times them out automatically once
// they've been outside it for a couple of consecutive location pings (see
// the context + backend heartbeat for the actual thresholds). The employee
// can walk in and out of the geofence as many times as they like while the
// event is still running — every visit opens a new session and adds to the
// same running total below. This screen is just a live window into that
// state; there's nothing to tap.
export default function AttendanceScreen({ route }) {
  const tracking = useAttendanceTracking();
  const geofenceId = route?.params?.geofenceId ?? null;
  const [, forceTick] = useState(0);

  // Re-render once a second so the "on-going" duration visibly counts up
  // instead of only updating whenever a new location/heartbeat happens to land.
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const geofence = useMemo(
    () => (tracking?.geofences || []).find((g) => g.id === geofenceId) || null,
    [tracking?.geofences, geofenceId]
  );
  const eventId = geofence?.event_id;
  const presence = eventId != null ? tracking?.presence?.[eventId] : null;
  const session = eventId != null ? tracking?.sessions?.[eventId] : null;

  const isInside = !!presence?.inside;
  const isOpen = !!session?.id && !session?.time_out;
  const hasAnySession = !!session?.id;
  const durationSeconds = eventId != null ? tracking?.getDurationSeconds?.(eventId) || 0 : 0;
  const sessionCount = session?.session_count || 0;

  let statusLabel = 'Checking your location…';
  if (!geofence) statusLabel = 'This event is no longer available.';
  else if (isOpen) statusLabel = `You are inside "${geofence.title}" — time is being recorded.`;
  else if (isInside) statusLabel = 'Inside the geofence — timing in…';
  else statusLabel = `Outside the "${geofence.title}" geofence boundary.`;

  const statusIsGood = isInside || isOpen;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20 }}>
      <View style={[styles.statusCard, { backgroundColor: statusIsGood ? colors.successBg : '#FEE2E2' }]}>
        <Text style={[styles.statusText, { color: statusIsGood ? colors.success : colors.error }]}>{statusLabel}</Text>
        {tracking?.accuracy != null && <Text style={styles.accuracyText}>GPS accuracy: {Math.round(tracking.accuracy)}m</Text>}
      </View>

      {geofence && (
        <View style={styles.eventCard}>
          <Text style={styles.eventTitle}>{geofence.title}</Text>
          <Text style={styles.eventVenue}>📍 {geofence.venue}</Text>
        </View>
      )}

      <View style={styles.durationCard}>
        <Text style={styles.durationLabel}>{isOpen ? 'On-going — total time today' : 'Total time recorded today'}</Text>
        <Text style={styles.durationValue}>{formatDuration(durationSeconds)}</Text>
        {sessionCount > 1 && (
          <Text style={styles.sessionCountText}>Across {sessionCount} time-in/time-out sessions</Text>
        )}
      </View>

      <View style={styles.infoCard}>
        <Text style={styles.infoText}>
          {hasAnySession
            ? 'Attendance is automatic — leaving and re-entering the event area will keep timing you in and out, and your total time keeps adding up until the event ends.'
            : 'Attendance is automatic — walk into the event area and you\'ll be timed in without needing to tap anything.'}
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  statusCard: { borderRadius: radius.md, padding: 18, marginBottom: 14 },
  statusText: { fontWeight: '800', fontSize: 14 },
  accuracyText: { color: colors.textMain, fontSize: 12, marginTop: 6 },
  eventCard: { backgroundColor: colors.white, borderRadius: radius.md, padding: 18, marginBottom: 14, borderWidth: 1, borderColor: colors.border, ...shadow },
  eventTitle: { fontWeight: '800', color: colors.cspcBlue, fontSize: 16 },
  eventVenue: { color: colors.textSub, marginTop: 4, fontSize: 12 },
  durationCard: {
    backgroundColor: colors.primary, borderRadius: radius.md, padding: 22, marginBottom: 14,
    alignItems: 'center', ...shadow, shadowColor: colors.primary, shadowOpacity: 0.3,
  },
  durationLabel: { color: 'rgba(255,255,255,0.75)', fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  durationValue: { color: '#fff', fontSize: 34, fontWeight: '800', marginTop: 8 },
  sessionCountText: { color: 'rgba(255,255,255,0.8)', fontSize: 11, fontWeight: '600', marginTop: 8 },
  infoCard: { backgroundColor: colors.successBg, borderRadius: radius.md, padding: 14, marginBottom: 14 },
  infoText: { color: colors.success, fontSize: 12, fontWeight: '600' },
});
