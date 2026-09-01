import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, ScrollView, Modal, FlatList } from 'react-native';
import * as Device from 'expo-device';
import { useAuth } from '../context/AuthContext';
import { colors, radius, shadow } from '../theme';
import { getDeviceUid } from '../utils/device';

// Mirrors the backend's VALID_SUFFIXES list (controllers/employeeAuthController.js).
// '' (displayed as "None") is the default -- the field is optional.
const SUFFIX_OPTIONS = ['None', 'Jr.', 'Sr.', 'II', 'III', 'IV', 'V'];

// Mirrors #screen-register in the CSPC GeoAttend web prototype -- binds this
// device to the employee's admin-provisioned record after a first-time Google sign-in.
export default function RegistrationScreen({ navigation }) {
  const { pendingGoogle, completeRegistration, cancelRegistration } = useAuth();
  const [employeeCode, setEmployeeCode] = useState('');
  const [surname, setSurname] = useState('');
  const [givenName, setGivenName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [suffix, setSuffix] = useState('None');
  const [suffixPickerOpen, setSuffixPickerOpen] = useState(false);
  const [deviceInfo, setDeviceInfo] = useState('Detecting device...');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!pendingGoogle) {
      navigation.replace('Login');
      return;
    }
    // Pre-fill the Google-verified name so the employee usually just has to
    // fill in the Employee ID, splitting Google's given/family name into the
    // Surname / Given Name fields the admin record uses.
    setSurname(pendingGoogle.google?.family_name || '');
    setGivenName(pendingGoogle.google?.given_name || '');
    (async () => {
      const uid = getDeviceUid();
      setDeviceInfo(`MODEL: ${Device.modelName || 'Unknown'}\nOS: ${Device.osName || ''} ${Device.osVersion || ''}\nDEVICE ID: ${uid}`);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingGoogle]);

  const handleSignIn = async () => {
    if (!employeeCode.trim() || !surname.trim() || !givenName.trim()) {
      setErrorMsg('Employee ID, Surname, and Given Name are required.');
      return;
    }
    setErrorMsg('');
    setSubmitting(true);
    try {
      const uid = getDeviceUid();
      await completeRegistration({
        employee_code: employeeCode.trim().toUpperCase(),
        surname: surname.trim(),
        given_name: givenName.trim(),
        middle_name: middleName.trim() || null,
        suffix: suffix === 'None' ? '' : suffix,
        device_uid: uid,
        device_model: Device.modelName,
        device_brand: Device.brand,
        device_os: `${Device.osName} ${Device.osVersion}`
      });
      // RootNavigator (App.js) reacts to `employee` + `deviceStatus` automatically:
      // a 'pending' device is routed to the WaitingApproval screen, which will in
      // turn redirect to Home the moment an admin approves it.
    } catch (err) {
      setErrorMsg(err.response?.data?.message || 'Registration failed. Please check your details and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = () => {
    cancelRegistration();
    navigation.replace('Login');
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20, paddingTop: 40 }}>
      <Text style={styles.header}>Device Registration</Text>
      <Text style={styles.subtext}>
        Signed in as {pendingGoogle?.google?.given_name || ''} {pendingGoogle?.google?.family_name || ''} ({pendingGoogle?.google?.email}).
        Confirm your official employee details to bind this device.
      </Text>

      <View style={styles.card}>
        <Text style={styles.inputLabel}>Employee ID *</Text>
        <TextInput
          style={styles.input}
          placeholder="e.g. E001"
          placeholderTextColor="#94A3B8"
          autoCapitalize="characters"
          value={employeeCode}
          onChangeText={setEmployeeCode}
        />

        <Text style={styles.inputLabel}>Surname *</Text>
        <TextInput
          style={styles.input}
          placeholder="Dela Cruz"
          placeholderTextColor="#94A3B8"
          value={surname}
          onChangeText={setSurname}
        />

        <Text style={styles.inputLabel}>Given Name *</Text>
        <TextInput
          style={styles.input}
          placeholder="Juan"
          placeholderTextColor="#94A3B8"
          value={givenName}
          onChangeText={setGivenName}
        />

        <Text style={styles.inputLabel}>Middle Name</Text>
        <TextInput
          style={styles.input}
          placeholder="Optional"
          placeholderTextColor="#94A3B8"
          value={middleName}
          onChangeText={setMiddleName}
        />

        <Text style={styles.inputLabel}>Suffix Name</Text>
        <TouchableOpacity style={styles.dropdownInput} onPress={() => setSuffixPickerOpen(true)}>
          <Text style={suffix === 'None' ? styles.dropdownPlaceholder : styles.dropdownValue}>{suffix}</Text>
          <Text style={styles.dropdownCaret}>{'\u25BE'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.deviceCard}>
        <Text style={styles.deviceText}>{deviceInfo}</Text>
      </View>

      {!!errorMsg && <Text style={styles.errorText}>{errorMsg}</Text>}

      <TouchableOpacity style={styles.confirmBtn} onPress={handleSignIn} disabled={submitting}>
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.confirmBtnText}>Sign In</Text>}
      </TouchableOpacity>
      <TouchableOpacity style={styles.cancelBtn} onPress={handleCancel} disabled={submitting}>
        <Text style={styles.cancelBtnText}>Cancel</Text>
      </TouchableOpacity>

      {/* Simple modal-based dropdown for Suffix Name -- avoids pulling in a native
          picker dependency that would require a new dev-client build. */}
      <Modal visible={suffixPickerOpen} transparent animationType="fade" onRequestClose={() => setSuffixPickerOpen(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setSuffixPickerOpen(false)}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Suffix Name</Text>
            <FlatList
              data={SUFFIX_OPTIONS}
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.modalOption}
                  onPress={() => {
                    setSuffix(item);
                    setSuffixPickerOpen(false);
                  }}
                >
                  <Text style={[styles.modalOptionText, item === suffix && styles.modalOptionTextActive]}>{item}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { fontSize: 20, fontWeight: '800', color: colors.cspcBlue },
  subtext: { color: colors.textSub, fontSize: 13, marginTop: 6, marginBottom: 18, lineHeight: 18 },
  card: {
    backgroundColor: colors.white, borderRadius: radius.lg, padding: 18,
    borderWidth: 1, borderColor: colors.border, ...shadow, marginBottom: 15,
  },
  inputLabel: { fontSize: 10, fontWeight: '800', color: colors.cspcBlue, textTransform: 'uppercase', marginBottom: 6, marginTop: 10 },
  input: { borderWidth: 2, borderColor: colors.border, borderRadius: radius.sm, padding: 12, fontSize: 14, color: colors.textMain },
  dropdownInput: {
    borderWidth: 2, borderColor: colors.border, borderRadius: radius.sm, padding: 12,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  dropdownPlaceholder: { fontSize: 14, color: '#94A3B8' },
  dropdownValue: { fontSize: 14, color: colors.textMain },
  dropdownCaret: { fontSize: 14, color: colors.textSub },
  deviceCard: { backgroundColor: colors.primaryLight, borderRadius: radius.md, padding: 16, marginBottom: 8 },
  deviceText: { fontFamily: 'monospace', fontSize: 12, lineHeight: 18, color: colors.textMain },
  errorText: { color: colors.error, fontSize: 12, marginVertical: 8, textAlign: 'center' },
  confirmBtn: { backgroundColor: colors.primary, borderRadius: radius.md, padding: 16, alignItems: 'center', marginTop: 15, ...shadow, shadowColor: colors.primary, shadowOpacity: 0.3 },
  confirmBtnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  cancelBtn: { padding: 14, alignItems: 'center', marginTop: 4, marginBottom: 20 },
  cancelBtnText: { color: colors.textSub, fontWeight: '700', fontSize: 13 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.45)', justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: colors.white, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, paddingTop: 12, paddingBottom: 24, maxHeight: '55%' },
  modalTitle: { fontSize: 13, fontWeight: '800', color: colors.cspcBlue, textTransform: 'uppercase', textAlign: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border },
  modalOption: { paddingVertical: 16, paddingHorizontal: 24, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  modalOptionText: { fontSize: 15, color: colors.textMain, textAlign: 'center' },
  modalOptionTextActive: { color: colors.cspcBlue, fontWeight: '800' },
});
