import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, View } from 'react-native';

import { AuthProvider, useAuth } from './src/context/AuthContext';
import { AttendanceTrackingProvider } from './src/context/AttendanceTrackingContext';
import LoginScreen from './src/screens/LoginScreen';
import RegistrationScreen from './src/screens/RegistrationScreen';
import WaitingApprovalScreen from './src/screens/WaitingApprovalScreen';
import WifiCheckScreen from './src/screens/WifiCheckScreen';
import DashboardScreen from './src/screens/DashboardScreen';
import AttendanceScreen from './src/screens/AttendanceScreen';
import HistoryScreen from './src/screens/HistoryScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import { colors } from './src/theme';

const Stack = createNativeStackNavigator();

function RootNavigator() {
  const { employee, loading, deviceStatus } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.cspcBlue }}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  // A signed-in employee whose device hasn't been approved by an admin yet is
  // held on WaitingApproval — it's the only screen in that stack, so there's
  // nowhere else to navigate to until deviceStatus flips to 'approved' (or the
  // employee signs out). The moment WaitingApprovalScreen's polling detects
  // approval, this component re-renders into the Dashboard stack below.
  const awaitingApproval = !!employee && deviceStatus === 'pending';

  return (
    <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: colors.cspcBlue }, headerTintColor: '#fff', headerTitleStyle: { fontWeight: '800' } }}>
      {!employee ? (
        <>
          <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Registration" component={RegistrationScreen} options={{ headerShown: false }} />
        </>
      ) : awaitingApproval ? (
        <Stack.Screen name="WaitingApproval" component={WaitingApprovalScreen} options={{ headerShown: false }} />
      ) : (
        <>
          {/* WifiCheck runs first after login/registration — confirms the device is on
              the designated location Wi-Fi network before it can reach the Dashboard. */}
          <Stack.Screen name="WifiCheck" component={WifiCheckScreen} options={{ headerShown: false, title: 'Network Check' }} />
          {/* Home / Logs / Profile render their own in-content header + bottom nav, mirroring the web prototype */}
          <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ headerShown: false }} />
          <Stack.Screen name="History" component={HistoryScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Profile" component={ProfileScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Attendance" component={AttendanceScreen} options={{ title: 'Mark Attendance' }} />
        </>
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <AuthProvider>
      {/* Runs app-wide (not just while the Attendance screen is open) so
          entering/leaving an event's geofence auto time-in/out's the
          employee no matter which screen they're looking at — see
          AttendanceTrackingContext for the full auto-tracking loop. */}
      <AttendanceTrackingProvider>
        <NavigationContainer>
          <StatusBar style="auto" />
          <RootNavigator />
        </NavigationContainer>
      </AttendanceTrackingProvider>
    </AuthProvider>
  );
}
