import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { colors, radius, shadow } from '../theme';

const POLL_INTERVAL_MS = 8000;

// Shown right after registration (or on relaunch, if the device is still
// pending). Polls GET /employee-auth/device-status in the background; the
// moment an admin approves the device, AuthContext's `deviceStatus` flips to
// 'approved' and RootNavigator (App.js) automatically swaps this screen out
// for the WifiCheck → Dashboard stack. Nothing here navigates directly.
export default function WaitingApprovalScreen() {
  const { employee, refreshDeviceStatus, logout } = useAuth();
  const [checking, setChecking] = useState(false);
  const intervalRef = useRef(null);

  useEffect(() => {
    const poll = async () => {
      setChecking(true);
      await refreshDeviceStatus();
      setChecking(false);
    };
    poll(); // check immediately on mount, then on an interval
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(intervalRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={styles.iconCircle}>
          <ActivityIndicator size="large" color={colors.waitingText} />
        </View>
        <Text style={styles.title}>Waiting for Approval</Text>
        <Text style={styles.body}>
          Your device has been registered{employee ? ` for ${employee.full_name}` : ''} and is
          pending admin approval. Once your administrator approves this device, you'll be taken
          to your Home screen automatically — no need to reopen the app.
        </Text>
        <Text style={styles.hint}>{checking ? 'Checking status…' : 'We\u2019ll keep checking automatically.'}</Text>
      </View>

      <TouchableOpacity style={styles.logoutBtn} onPress={logout}>
        <Text style={styles.logoutBtnText}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: {
    backgroundColor: colors.white, borderRadius: radius.lg, padding: 28,
    borderWidth: 1, borderColor: colors.border, ...shadow, alignItems: 'center', maxWidth: 420, width: '100%',
  },
  iconCircle: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: colors.waitingBg,
    alignItems: 'center', justifyContent: 'center', marginBottom: 18,
  },
  title: { fontSize: 20, fontWeight: '800', color: colors.cspcBlue, marginBottom: 10, textAlign: 'center' },
  body: { fontSize: 13, color: colors.textSub, lineHeight: 19, textAlign: 'center' },
  hint: { fontSize: 11, color: colors.waitingText, fontWeight: '700', marginTop: 18, textAlign: 'center' },
  logoutBtn: { padding: 14, marginTop: 24 },
  logoutBtnText: { color: colors.textSub, fontWeight: '700', fontSize: 13 },
});
