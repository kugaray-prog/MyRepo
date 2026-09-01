import Constants from 'expo-constants';

const extra = Constants.expoConfig?.extra || {};

// These must match the OAuth Client IDs you create in Google Cloud Console
// (APIs & Services > Credentials) and the GOOGLE_CLIENT_ID already set in the
// server's .env. The Web Client ID is required; iOS/Android are optional but
// recommended for a native (non-browser) Google Sign-In experience.
export const GOOGLE_WEB_CLIENT_ID = extra.googleWebClientId || '';
export const GOOGLE_IOS_CLIENT_ID = extra.googleIosClientId || '';
export const GOOGLE_ANDROID_CLIENT_ID = extra.googleAndroidClientId || '';

export const isGoogleConfigured = () =>
  !!GOOGLE_WEB_CLIENT_ID && !GOOGLE_WEB_CLIENT_ID.startsWith('your_');

// Fallback Wi-Fi network name used by WifiCheckScreen to confirm the employee is
// on the designated location network before reaching the Dashboard. If the
// active event's geofence record from the API includes its own `wifi_ssid`
// field, that value takes priority over this default (see WifiCheckScreen.js).
export const REQUIRED_WIFI_SSID = extra.requiredWifiSsid || 'CSPC Student Wi-Fi';
