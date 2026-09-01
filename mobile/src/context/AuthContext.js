import React, { createContext, useState, useEffect, useContext } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import api, { googleLogin, linkDevice, getDeviceStatus, setStaleSessionHandler } from '../api/client';
import { getDeviceUid } from '../utils/device';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [employee, setEmployee] = useState(null);
  const [loading, setLoading] = useState(true);
  // Mirrors mobile_devices.status for THIS device: 'pending' | 'approved' |
  // 'rejected' | null. An employee may have several registered devices with
  // different statuses, so this always reflects the one this app install is
  // running on. RootNavigator uses this to gate access to the Dashboard stack —
  // a signed-in employee whose device is still 'pending' is held on the
  // WaitingApproval screen until an admin approves it.
  const [deviceStatus, setDeviceStatus] = useState(null);
  // Set right after a Google sign-in that didn't match an existing employee yet —
  // consumed by RegistrationScreen to finish linking the device.
  const [pendingGoogle, setPendingGoogle] = useState(null); // { pendingToken, google }
  // Set true when the server reports this device's cached employee record no
  // longer exists (e.g. deleted/recreated by an admin). LoginScreen reads
  // this to explain why the app suddenly returned to the login screen.
  const [staleSession, setStaleSession] = useState(false);

  useEffect(() => {
    (async () => {
      const stored = await AsyncStorage.getItem('employee_data');
      const storedStatus = await AsyncStorage.getItem('device_status');
      if (stored) {
        setEmployee(JSON.parse(stored));
        setDeviceStatus(storedStatus || null);
      }
      setLoading(false);
      // Re-check with the server in case the device was approved (or revoked)
      // while the app was closed.
      if (stored) refreshDeviceStatus();
    })();
  }, []);

  const persistDeviceStatus = async (status) => {
    setDeviceStatus(status);
    if (status) await AsyncStorage.setItem('device_status', status);
    else await AsyncStorage.removeItem('device_status');
  };

  // Polled by WaitingApprovalScreen — asks the server for this device's current
  // status so the app can automatically move on once an admin approves it.
  const refreshDeviceStatus = async () => {
    try {
      const data = await getDeviceStatus(getDeviceUid(employee?.id));
      await persistDeviceStatus(data.deviceStatus);
      return data.deviceStatus;
    } catch (err) {
      // Network hiccup or expired token — leave the current status alone and
      // let the next poll try again.
      return deviceStatus;
    }
  };

  // Step 1: exchange the Google ID token for either a full login (already-linked
  // employee) or a short-lived pendingToken to continue on to device registration.
  const loginWithGoogle = async (idToken) => {
    const data = await googleLogin(idToken, getDeviceUid());
    setStaleSession(false);
    if (data.matched) {
      await AsyncStorage.setItem('employee_token', data.token);
      await AsyncStorage.setItem('employee_data', JSON.stringify(data.employee));
      setEmployee(data.employee);
      await persistDeviceStatus(data.deviceStatus || null);
      return { matched: true };
    }
    setPendingGoogle({ pendingToken: data.pendingToken, google: data.google });
    return { matched: false, google: data.google };
  };

  // Step 2 (first-time devices only): confirm the employee's admin-provisioned
  // identity (Employee ID + Surname + Given Name, plus optional Middle Name /
  // Suffix) and register this device. The device starts out 'pending' until an
  // admin approves it — RootNavigator holds the user on WaitingApproval until then.
  const completeRegistration = async ({ employee_code, surname, given_name, middle_name, suffix, device_uid, device_model, device_brand, device_os }) => {
    if (!pendingGoogle) throw new Error('Your Google sign-in session expired. Please sign in again.');
    const data = await linkDevice({
      pendingToken: pendingGoogle.pendingToken,
      employee_code,
      surname,
      given_name,
      middle_name,
      suffix,
      device_uid,
      device_model,
      device_brand,
      device_os
    });
    await AsyncStorage.setItem('employee_token', data.token);
    await AsyncStorage.setItem('employee_data', JSON.stringify(data.employee));
    setEmployee(data.employee);
    await persistDeviceStatus(data.deviceStatus || null);
    setPendingGoogle(null);
    return data;
  };

  const cancelRegistration = () => setPendingGoogle(null);

  const logout = async () => {
    await AsyncStorage.multiRemove(['employee_token', 'employee_data', 'device_status']);
    setEmployee(null);
    setDeviceStatus(null);
  };

  // Registered once so ANY API call (device registration, attendance submit,
  // heartbeat, etc.) can trigger this — see api/client.js's response
  // interceptor. Clears the stale local session and returns the user to
  // Login instead of leaving them stuck on a raw error screen.
  useEffect(() => {
    setStaleSessionHandler(() => {
      setStaleSession(true);
      logout();
    });
  }, []);

  return (
    <AuthContext.Provider value={{ employee, loading, deviceStatus, pendingGoogle, staleSession, loginWithGoogle, completeRegistration, cancelRegistration, refreshDeviceStatus, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
