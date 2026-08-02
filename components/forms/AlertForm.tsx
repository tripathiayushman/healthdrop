// =====================================================
// HEALTH ALERT FORM — Bharosa directive-first composer.
// Move 02: directive first, disease second. The composer
// IS the poster — compose on top ("What should people
// DO?"), a live B·03 poster preview below that updates
// as they type. Taxonomy lives in a collapsed DETAILS
// section because a scared family needs what to do, not
// epidemiology. Submission machinery is unchanged:
// getSession-first auth, tolerant NetInfo check, offline
// syncQueue, role-honest approval copy, same payload
// columns (metadata gains directive_hindi).
// =====================================================
import React, { useImperativeHandle, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  LayoutChangeEvent,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import NetInfo from '@react-native-community/netinfo';
import { useTheme, getSeverityColor, Theme, spacing, radii } from '../../lib/ThemeContext';
import { supabase } from '../../lib/supabase';
import { useFormDraft, FormExitHandle } from '../../lib/useFormDraft';
import { DiscardChangesSheet, RestoreDraftSheet, DraftStorageNotice } from '../../lib/FormGuardSheets';
import { SubmissionModal, StatusBadge } from '../shared';
import { LocationField } from '../../src/components/LocationField';
import { Profile } from '../../types';
import { syncQueue } from '../../src/services/offlineSync/SyncQueue';

interface AlertFormProps {
  onSuccess: () => void;
  onCancel: () => void;
  profile?: Profile;
  /** BRK-14 — MainApp routes the Android hardware back press through here. */
  exitRef?: React.Ref<FormExitHandle>;
}

// ── Local building blocks ────────────────────────────────────────────────────

const SelectChip: React.FC<{
  label: string;
  selected: boolean;
  onPress: () => void;
  colors: Theme;
  fill?: string;
  selectedLabelColor?: string;
}> = ({ label, selected, onPress, colors, fill, selectedLabelColor }) => {
  const bg = fill ?? colors.primary;
  const labelColor = selectedLabelColor ?? colors.onPrimary;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? bg : pressed ? colors.cardHover : colors.card,
          borderColor: selected ? bg : colors.border,
        },
      ]}
    >
      {selected && <Ionicons name="checkmark" size={16} color={labelColor} />}
      <Text style={[styles.chipLabel, { color: selected ? labelColor : colors.text }]}>
        {label}
      </Text>
    </Pressable>
  );
};

const FieldError: React.FC<{ message?: string; colors: Theme }> = ({ message, colors }) => {
  if (!message) return null;
  return (
    <View style={styles.errorRow} accessibilityLiveRegion="polite">
      <Ionicons name="alert-circle" size={16} color={colors.danger} />
      <Text style={[styles.errorText, { color: colors.danger }]}>{message}</Text>
    </View>
  );
};

/**
 * B·03 "DO THESE THREE THINGS" — mirrors the parser in
 * AllAlertsScreen so the preview shows exactly what field
 * workers will see: split on newlines & semicolons, strip
 * manual numbering, keep the first 3, dedupe.
 */
const parseDirectiveSteps = (
  ...sources: (string | null | undefined)[]
): string[] => {
  const steps: string[] = [];
  for (const source of sources) {
    if (typeof source !== 'string' || !source.trim()) continue;
    const parts = source
      .split(/[\n;]+/)
      .map((s) => s.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, '').trim())
      .filter(Boolean);
    if (parts.length === 0) parts.push(source.trim());
    for (const p of parts) {
      if (!steps.some((s) => s.toLowerCase() === p.toLowerCase())) steps.push(p);
      if (steps.length >= 3) return steps;
    }
  }
  return steps;
};

const stepsHeading = (n: number): string =>
  n >= 3 ? 'DO THESE THREE THINGS' : n === 2 ? 'DO THESE TWO THINGS' : 'DO THIS ONE THING';

const FIELD_ORDER = ['title', 'description', 'steps', 'location'];

const DO_STEP_PLACEHOLDERS = [
  'Boil water for 1 minute, or use chlorine tablets',
  'Wash hands with soap before eating',
  'Loose motion + vomiting → clinic same day',
];

export const AlertForm: React.FC<AlertFormProps> = ({ onSuccess, onCancel, profile, exitRef }) => {
  const { colors, reduceMotion } = useTheme();
  const [loading, setLoading] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [modalVisible, setModalVisible] = useState(false);
  const [modalType, setModalType] = useState<'success' | 'error'>('success');
  const [modalMessage, setModalMessage] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);

  const scrollRef = useRef<ScrollView>(null);
  const sectionYRef = useRef<Record<string, number>>({});
  const fieldYRef = useRef<Record<string, number>>({});
  const fieldSectionRef = useRef<Record<string, string>>({});

  // Lazy initialiser: the idempotency key below must be minted once per
  // filling-in, not re-rolled (and thrown away) on every render.
  const [formData, setFormData] = useState(() => ({
    // Alert Type
    alert_type: 'disease_outbreak',
    urgency_level: 'high',

    // The directive — the loudest sentence in the system
    title: '',
    directive_hindi: '',
    description: '',

    // THREE THINGS TO DO → joined with newlines into precautionary_measures
    do_step_1: '',
    do_step_2: '',
    do_step_3: '',

    // Affected Area
    location_name: '',
    district: '',
    state: '',
    affected_population: '',

    // Health Details (taxonomy — comes last)
    disease_or_issue: '',
    custom_disease: '',
    symptoms_to_watch: '',
    cases_reported: '',
    deaths_reported: '',

    // Staff-facing actions (also joins the poster do-list when short)
    immediate_actions: '',

    // Contact Info
    contact_person: '',
    contact_phone: '',
    emergency_helpline: '',

    // One idempotency key per filling-in, carried INSIDE the draft snapshot so
    // it survives the save/restore round trip. health_alerts already has a
    // UNIQUE index on client_idempotency_key (verified against the live
    // project) and the offline queue has always used one — only this online
    // insert did not. On one bar of signal the row can commit while the
    // response is lost; the draft survives, she restores and sends again, and
    // a SECOND alert lands. For an alert that is not just a duplicate row:
    // trg_push_on_alert_created fires per insert, so an author whose role is
    // auto-approved would push the same warning to the same district twice.
    // Never regenerated per send — a key minted at send time cannot collide
    // with the row already inserted.
    client_idempotency_key: `alr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
  }));

  // ── NEW-01 / BRK-14 — draft autosave + dirty guard ─────────────────────────
  const draft = useFormDraft({
    formKey: 'alert',
    userId: profile?.id,
    values: formData,
  });

  const [confirmExit, setConfirmExit] = useState(false);

  const applyDraft = () => {
    const values = draft.restore();
    if (!values) return;
    // Merged over the live defaults, so a draft written by an older build can
    // never blank a field that build did not have.
    setFormData((prev) => ({ ...prev, ...values }));
    setErrors({});
    // Restored taxonomy must not stay hidden behind a collapsed disclosure.
    const hasDetails = [
      values.disease_or_issue,
      values.custom_disease,
      values.symptoms_to_watch,
      values.cases_reported,
      values.deaths_reported,
      values.affected_population,
      values.immediate_actions,
      values.emergency_helpline,
    ].some((field) => String(field ?? '').trim().length > 0);
    if (hasDetails) setDetailsOpen(true);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  const alertTypes = [
    { label: 'Disease Outbreak', value: 'disease_outbreak' },
    { label: 'Water Contamination', value: 'water_contamination' },
    { label: 'Food Poisoning', value: 'food_poisoning' },
    { label: 'Vector Alert', value: 'vector_alert' },
    { label: 'Toxic Exposure', value: 'toxic_exposure' },
    { label: 'Medical Emergency', value: 'medical_emergency' },
    { label: 'General Health Alert', value: 'general' },
  ];

  const urgencyLevels = [
    { label: 'Critical', value: 'critical', desc: 'Immediate action needed' },
    { label: 'High', value: 'high', desc: 'Urgent attention required' },
    { label: 'Medium', value: 'medium', desc: 'Important, monitor closely' },
    { label: 'Low', value: 'low', desc: 'Advisory information' },
  ];

  const commonDiseases = [
    'Cholera', 'Typhoid', 'Malaria', 'Dengue', 'Chikungunya',
    'COVID-19', 'Influenza', 'Hepatitis', 'Diarrhea', 'Gastroenteritis', 'Other',
  ];

  // THREE THINGS TO DO, joined for precautionary_measures (payload-identical column)
  const joinedPrecautions = [formData.do_step_1, formData.do_step_2, formData.do_step_3]
    .map((s) => s.trim())
    .filter(Boolean)
    .join('\n');

  // ── Layout tracking for scroll-to-first-error ─────────────────────────────
  const onSectionLayout = (section: string) => (e: LayoutChangeEvent) => {
    sectionYRef.current[section] = e.nativeEvent.layout.y;
  };
  const onFieldLayout = (section: string, field: string) => (e: LayoutChangeEvent) => {
    fieldYRef.current[field] = e.nativeEvent.layout.y;
    fieldSectionRef.current[field] = section;
  };
  const scrollToFirstError = (errs: Record<string, string>) => {
    const first = FIELD_ORDER.find((f) => errs[f]);
    if (!first) return;
    const section = fieldSectionRef.current[first];
    const y =
      (section ? sectionYRef.current[section] ?? 0 : 0) + (fieldYRef.current[first] ?? 0);
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: !reduceMotion });
  };

  const clearError = (field: string) => {
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const setDoStep = (key: 'do_step_1' | 'do_step_2' | 'do_step_3', text: string) => {
    const next = { ...formData, [key]: text };
    setFormData(next);
    if ([next.do_step_1, next.do_step_2, next.do_step_3].some((s) => s.trim())) {
      clearError('steps');
    }
  };

  const getInputStyle = (fieldName: string) => [
    styles.input,
    {
      backgroundColor: colors.inputBackground,
      color: colors.text,
      borderColor: errors[fieldName]
        ? colors.inputErrorBorder
        : focusedField === fieldName
          ? colors.inputFocusBorder
          : colors.inputBorder,
      borderWidth: errors[fieldName] || focusedField === fieldName ? 2 : 1.5,
    },
  ];

  const getTextAreaStyle = (fieldName: string) => [...getInputStyle(fieldName), styles.textArea];

  const validateForm = (): Record<string, string> => {
    const errs: Record<string, string> = {};
    if (!formData.title.trim()) errs.title = 'Write the directive — what should people do?';
    if (!formData.description.trim()) errs.description = 'Describe what is happening';
    if (!joinedPrecautions) errs.steps = 'Add at least one thing people should do';
    if (!formData.location_name.trim() || !formData.district.trim() || !formData.state) {
      errs.location = 'Enter location, district and state';
    }
    return errs;
  };

  const handleSubmit = async () => {
    const errs = validateForm();
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      scrollToFirstError(errs);
      return;
    }

    setLoading(true);
    try {
      // Resolve the user from the locally cached session first — getSession()
      // reads local storage (no network), so the offline sync-queue path below
      // stays reachable. Fall back to the network getUser() only when online
      // and no cached session exists.
      const { data: { session } } = await supabase.auth.getSession();
      let user = session?.user ?? null;

      const net = await NetInfo.fetch();
      const isOnline = net.isConnected !== false && net.isInternetReachable !== false;

      if (!user && isOnline) {
        const { data: userData } = await supabase.auth.getUser();
        user = userData.user;
      }

      if (!user) {
        setModalType('error');
        setModalMessage('You must be logged in to send an alert.');
        setModalVisible(true);
        setLoading(false);
        return;
      }

      const diseaseValue = formData.disease_or_issue === 'Other' ? formData.custom_disease : formData.disease_or_issue;
      const isAshaWorker = profile?.role === 'asha_worker';

      const payload = {
        created_by: user.id,
        alert_type: formData.alert_type,
        urgency_level: formData.urgency_level,
        title: formData.title,
        description: formData.description,
        location_name: formData.location_name,
        district: formData.district,
        state: formData.state,
        affected_population: parseInt(formData.affected_population) || 0,
        disease_or_issue: diseaseValue,
        symptoms_to_watch: formData.symptoms_to_watch,
        cases_reported: parseInt(formData.cases_reported) || 0,
        immediate_actions: formData.immediate_actions,
        precautionary_measures: joinedPrecautions,
        contact_person: formData.contact_person,
        contact_phone: formData.contact_phone,
        status: 'active',
        // health_alerts has no deaths_reported / emergency_helpline columns in the
        // live schema — persist them in the metadata jsonb column instead of
        // silently dropping what the worker typed. directive_hindi is the
        // Devanagari poster headline read by AllAlertsScreen's B·03 poster.
        metadata: {
          deaths_reported: parseInt(formData.deaths_reported) || 0,
          emergency_helpline: formData.emergency_helpline.trim() || null,
          directive_hindi: formData.directive_hindi.trim() || null,
        },
        // Stable across every attempt at THIS filling-in — see the snapshot.
        client_idempotency_key: formData.client_idempotency_key,
      };

      if (!isOnline) {
        await syncQueue.enqueue('health_alert', payload);
        // Queued to sync — the draft has done its job.
        draft.clear();
        setModalType('success');
        if (isAshaWorker) {
          setModalMessage(
            'Saved on phone — will sync. Your alert request will upload automatically when you are back online, then go to Admin/Clinic review before other users see it in the app.'
          );
        } else {
          setModalMessage(
            'Saved on phone — will sync. Your alert will be published automatically when you are back online.'
          );
        }
        setModalVisible(true);
        return;
      }

      // ignoreDuplicates turns a resend of an already-committed alert into a
      // no-op rather than a unique-violation error she cannot act on.
      let { error } = await supabase
        .from('health_alerts')
        .upsert(payload, { onConflict: 'client_idempotency_key', ignoreDuplicates: true });

      // Schema-drift armour, mirroring lib/services/diseaseReports.ts: if this
      // deployment's table lacks the column or the UNIQUE constraint, fall back
      // to the plain insert this form always did rather than fail the send.
      if (error && /client_idempotency_key|on conflict|no unique or exclusion constraint/i.test(String(error.message ?? ''))) {
        const { client_idempotency_key: _dropped, ...legacyPayload } = payload;
        ({ error } = await supabase.from('health_alerts').insert(legacyPayload));
      }

      if (error) throw error;

      // Sent — the draft has done its job.
      draft.clear();

      // Push delivery is handled server-side, and only for an alert a HUMAN has
      // approved. Both triggers on health_alerts gate on approval_status:
      // trg_push_on_alert_created (AFTER INSERT) returns early unless the row
      // is already 'approved' — which auto_approve_alert_fn only does for
      // super_admin / health_admin / clinic / district_officer authors — and
      // trg_push_on_alert_approved (AFTER UPDATE OF approval_status) covers the
      // reviewed path, so an ASHA worker's request pushes nothing until someone
      // approves it. No client-side fan-out: it would double-notify and cannot
      // enumerate tokens under profiles RLS for most roles.

      // Role-aware, honest success message
      setModalType('success');
      if (isAshaWorker) {
        // Honest per actual insert behavior: the row is inserted immediately and
        // the server-side push fan-out fires on insert; only in-app visibility
        // for other users waits on Admin/Clinic approval (DB auto_approve trigger).
        setModalMessage(
          'Your alert has been submitted and health officials will be notified. It will appear inside the app for other users after an Admin or Clinic staff member approves it.'
        );
      } else {
        setModalMessage(
          'Your health alert has been published successfully. Health officials will be notified.'
        );
      }
      setModalVisible(true);
    } catch (error: any) {
      console.error('Alert submit error:', error);
      setModalType('error');
      setModalMessage(error.message || 'Failed to send alert. Please try again or contact emergency services directly.');
      setModalVisible(true);
    } finally {
      setLoading(false);
    }
  };

  const handleModalClose = () => {
    setModalVisible(false);
    if (modalType === 'success') {
      onSuccess();
    }
  };

  /** Cancel means "leave" — so it always faces the dirty guard. */
  const handleCancelPress = () => {
    if (draft.dirty) {
      setConfirmExit(true);
      return;
    }
    onCancel();
  };

  const discardAndLeave = () => {
    setConfirmExit(false);
    draft.clear();
    onCancel();
  };

  // BRK-14 — "back" in this app's own terms, shared by the header Back button
  // and MainApp's hardware-back listener.
  //
  // The two are the same code path for every NON-modal state. They are not
  // identical while a Modal is up: on Android a visible Modal's Dialog answers
  // the back press through its own onRequestClose before any BackHandler
  // listener runs, and the chevron is behind that Modal. The modalVisible and
  // confirmExit rungs below are therefore unreachable from the hardware key —
  // they stay as the correct answer for a non-Modal caller (react-native-web
  // renders Modal inline), not because a back press reaches them today. The
  // live rung is draft.offered: the restore sheet routes its onRequestClose
  // here on purpose.
  const requestClose = () => {
    if (modalVisible) {
      handleModalClose();
      return;
    }
    if (confirmExit) {
      setConfirmExit(false);
      return;
    }
    if (draft.offered) {
      // The draft stays on the phone — leaving is not deciding.
      onCancel();
      return;
    }
    if (draft.dirty) {
      setConfirmExit(true);
      return;
    }
    onCancel();
  };

  useImperativeHandle(exitRef, () => ({ requestClose }));

  const selectedUrgency = urgencyLevels.find(u => u.value === formData.urgency_level);
  const urgencyColorFor = (value: string) => getSeverityColor(value, colors);
  const isAsha = profile?.role === 'asha_worker';

  const showDiseaseFields =
    formData.alert_type === 'disease_outbreak' || formData.alert_type === 'food_poisoning';

  // ── Live poster derivations — same inputs the B·03 renderer reads ─────────
  const previewHindi = formData.directive_hindi.trim();
  const previewTitle = formData.title.trim();
  const previewDescription = formData.description.trim();
  const previewSteps = parseDirectiveSteps(joinedPrecautions, formData.immediate_actions);
  const previewPhone = formData.contact_phone.trim();
  const previewPerson = formData.contact_person.trim();
  const previewDisease = (
    formData.disease_or_issue === 'Other' ? formData.custom_disease : formData.disease_or_issue
  ).trim();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header — headerBg surface, ink-on-surface, 1px hairline (both modes) */}
      <View
        style={[
          styles.header,
          {
            backgroundColor: colors.headerBg,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <Pressable
          onPress={requestClose}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
          <Text style={[styles.backText, { color: colors.text }]}>Back</Text>
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Send Health Alert</Text>
        <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
          The alert is a poster — write what people should do
        </Text>
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* ═══ COMPOSE — directive first, disease second (Move 02) ═══ */}

        {/* What should people DO? */}
        <View style={styles.section} onLayout={onSectionLayout('directive')}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
            What should people do?
          </Text>

          <View onLayout={onFieldLayout('directive', 'title')}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Directive — English *</Text>
            <Text style={[styles.help, { color: colors.textSecondary }]}>
              Verbs a 10-year-old can relay — "Boil water before drinking"
            </Text>
            <TextInput
              style={getInputStyle('title')}
              placeholder="Boil water before drinking"
              placeholderTextColor={colors.inputPlaceholderColor}
              value={formData.title}
              onChangeText={(text) => { setFormData({ ...formData, title: text }); clearError('title'); }}
              onFocus={() => setFocusedField('title')}
              onBlur={() => setFocusedField(null)}
            />
            <FieldError message={errors.title} colors={colors} />
          </View>

          <Text style={[styles.label, { color: colors.textSecondary }]}>Directive — Hindi · optional</Text>
          <Text style={[styles.help, { color: colors.textSecondary }]}>
            Devanagari first — the audience is the public
          </Text>
          <TextInput
            style={[...getInputStyle('directive_hindi'), styles.hindiInput]}
            placeholder="पानी उबालकर पिएँ"
            placeholderTextColor={colors.inputPlaceholderColor}
            value={formData.directive_hindi}
            onChangeText={(text) => setFormData({ ...formData, directive_hindi: text })}
            onFocus={() => setFocusedField('directive_hindi')}
            onBlur={() => setFocusedField(null)}
          />
        </View>

        {/* What is happening */}
        <View style={styles.section} onLayout={onSectionLayout('happening')}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
            What is happening
          </Text>
          <View onLayout={onFieldLayout('happening', 'description')}>
            <Text style={[styles.label, { color: colors.textSecondary }]}>Description *</Text>
            <TextInput
              style={getTextAreaStyle('description')}
              placeholder="One or two plain sentences — what, where, since when"
              placeholderTextColor={colors.inputPlaceholderColor}
              value={formData.description}
              onChangeText={(text) => { setFormData({ ...formData, description: text }); clearError('description'); }}
              onFocus={() => setFocusedField('description')}
              onBlur={() => setFocusedField(null)}
              multiline
              numberOfLines={4}
            />
            <FieldError message={errors.description} colors={colors} />
          </View>
        </View>

        {/* Three things to do */}
        <View style={styles.section} onLayout={onSectionLayout('steps')}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
            Three things to do
          </Text>
          <Text style={[styles.sectionDesc, { color: colors.textSecondary }]}>
            Short, sayable steps — at least one. They become the poster's numbered list.
          </Text>
          <View onLayout={onFieldLayout('steps', 'steps')}>
            {(['do_step_1', 'do_step_2', 'do_step_3'] as const).map((key, i) => (
              <View key={key} style={styles.stepInputRow}>
                <View style={[styles.stepInputNum, { borderColor: colors.inputBorder }]}>
                  <Text style={[styles.stepInputNumText, { color: colors.textSecondary }]}>
                    {i + 1}
                  </Text>
                </View>
                <TextInput
                  style={[...(errors.steps ? getInputStyle('steps') : getInputStyle(key)), styles.stepInput]}
                  placeholder={DO_STEP_PLACEHOLDERS[i]}
                  placeholderTextColor={colors.inputPlaceholderColor}
                  value={formData[key]}
                  onChangeText={(text) => setDoStep(key, text)}
                  onFocus={() => setFocusedField(key)}
                  onBlur={() => setFocusedField(null)}
                />
              </View>
            ))}
            <FieldError message={errors.steps} colors={colors} />
          </View>
        </View>

        {/* Helpline & contact */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
            Helpline & contact
          </Text>

          <Text style={[styles.label, { color: colors.textSecondary }]}>Helpline Phone</Text>
          <Text style={[styles.help, { color: colors.textSecondary }]}>
            Shown big on the poster with a Call button
          </Text>
          <TextInput
            style={getInputStyle('contact_phone')}
            placeholder="e.g., 104"
            placeholderTextColor={colors.inputPlaceholderColor}
            value={formData.contact_phone}
            onChangeText={(text) => setFormData({ ...formData, contact_phone: text.replace(/[^0-9]/g, '') })}
            onFocus={() => setFocusedField('contact_phone')}
            onBlur={() => setFocusedField(null)}
            keyboardType="phone-pad"
            maxLength={10}
          />

          <Text style={[styles.label, { color: colors.textSecondary }]}>Contact Person</Text>
          <TextInput
            style={getInputStyle('contact_person')}
            placeholder="Your name"
            placeholderTextColor={colors.inputPlaceholderColor}
            value={formData.contact_person}
            onChangeText={(text) => setFormData({ ...formData, contact_person: text })}
            onFocus={() => setFocusedField('contact_person')}
            onBlur={() => setFocusedField(null)}
          />
        </View>

        {/* How urgent? — severity chips, shape-coded */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>How urgent?</Text>
          <View style={styles.chipWrap}>
            {urgencyLevels.map((level) => (
              <SelectChip
                key={level.value}
                label={level.label}
                selected={formData.urgency_level === level.value}
                onPress={() => setFormData({ ...formData, urgency_level: level.value })}
                colors={colors}
                fill={urgencyColorFor(level.value)}
                selectedLabelColor={colors.textInverse}
              />
            ))}
          </View>
          {selectedUrgency && (
            <Text style={[styles.hintText, { color: colors.textSecondary }]}>
              {selectedUrgency.desc}
            </Text>
          )}
        </View>

        {/* Affected area */}
        <View style={styles.section} onLayout={onSectionLayout('location')}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>Affected Area</Text>

          <View onLayout={onFieldLayout('location', 'location')}>
            <LocationField
              value={{
                latitude: null,
                longitude: null,
                locationName: formData.location_name,
                district: formData.district,
                state: formData.state,
                formattedAddress: '',
              }}
              onChange={(loc) => {
                // A location block that has only ever held machine-written
                // values is not the user's work: re-arm the pristine mark so
                // Back still closes silently.
                //
                // The extra "was the location EMPTY before?" test meant only
                // the FIRST fix counted as the machine typing, so tapping
                // "Re-fetch" on an already-located, otherwise untouched form
                // raised "Leave without saving?" over an alert nobody had
                // written.
                //
                // Telling the machine from the user, exactly: LocationField
                // spreads the current `value` for every hand edit (typing an
                // area, typing a district, picking a registry suggestion), and
                // this form passes latitude: null and formattedAddress: '' in
                // that value — so a non-null latitude or a non-empty
                // formattedAddress can only have come from LocationField's own
                // GPS/geocode sync. Nothing typed satisfies either test.
                const machineFilled = loc.latitude != null || !!loc.formattedAddress;
                setFormData({
                  ...formData,
                  location_name: loc.locationName,
                  district: loc.district,
                  state: loc.state,
                });
                if (machineFilled && !draft.dirty) {
                  draft.markPristine();
                }
                if (loc.locationName && loc.district && loc.state) clearError('location');
              }}
              autoFetch={true}
            />
            <FieldError message={errors.location} colors={colors} />
          </View>
        </View>

        {/* DETAILS · optional — taxonomy comes last */}
        <View style={styles.section}>
          <Pressable
            onPress={() => setDetailsOpen((o) => !o)}
            accessibilityRole="button"
            accessibilityState={{ expanded: detailsOpen }}
            accessibilityLabel="Details, optional — disease, counts, symptoms"
            style={({ pressed }) => [
              styles.detailsToggle,
              {
                backgroundColor: pressed ? colors.cardHover : colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <Text style={[styles.sectionLabel, styles.detailsToggleLabel, { color: colors.textSecondary }]}>
              Details · optional
            </Text>
            <Ionicons
              name={detailsOpen ? 'chevron-up' : 'chevron-down'}
              size={20}
              color={colors.textSecondary}
            />
          </Pressable>
          <Text style={[styles.sectionDesc, styles.detailsDesc, { color: colors.textSecondary }]}>
            Disease name, counts, symptoms — the poster leads with the directive.
          </Text>

          {detailsOpen && (
            <View>
              <Text style={[styles.label, { color: colors.textSecondary }]}>Alert Type</Text>
              <View style={styles.chipWrap}>
                {alertTypes.map((type) => (
                  <SelectChip
                    key={type.value}
                    label={type.label}
                    selected={formData.alert_type === type.value}
                    onPress={() => setFormData({ ...formData, alert_type: type.value })}
                    colors={colors}
                  />
                ))}
              </View>

              {showDiseaseFields && (
                <>
                  <Text style={[styles.label, { color: colors.textSecondary }]}>Disease / Issue</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.chipScrollContent}
                  >
                    {commonDiseases.map((disease) => (
                      <SelectChip
                        key={disease}
                        label={disease}
                        selected={formData.disease_or_issue === disease}
                        onPress={() => setFormData({ ...formData, disease_or_issue: disease })}
                        colors={colors}
                      />
                    ))}
                  </ScrollView>

                  {formData.disease_or_issue === 'Other' && (
                    <>
                      <Text style={[styles.label, { color: colors.textSecondary }]}>Specify Disease / Issue</Text>
                      <TextInput
                        style={getInputStyle('custom_disease')}
                        placeholder="Disease or issue name"
                        placeholderTextColor={colors.inputPlaceholderColor}
                        value={formData.custom_disease}
                        onChangeText={(text) => setFormData({ ...formData, custom_disease: text })}
                        onFocus={() => setFocusedField('custom_disease')}
                        onBlur={() => setFocusedField(null)}
                      />
                    </>
                  )}

                  <Text style={[styles.label, { color: colors.textSecondary }]}>Symptoms to Watch</Text>
                  <TextInput
                    style={getInputStyle('symptoms')}
                    placeholder="e.g., fever, vomiting, diarrhea..."
                    placeholderTextColor={colors.inputPlaceholderColor}
                    value={formData.symptoms_to_watch}
                    onChangeText={(text) => setFormData({ ...formData, symptoms_to_watch: text })}
                    onFocus={() => setFocusedField('symptoms')}
                    onBlur={() => setFocusedField(null)}
                  />
                </>
              )}

              <Text style={[styles.label, { color: colors.textSecondary }]}>Cases Reported</Text>
              <TextInput
                style={getInputStyle('cases')}
                placeholder="Number of cases"
                placeholderTextColor={colors.inputPlaceholderColor}
                value={formData.cases_reported}
                onChangeText={(text) => setFormData({ ...formData, cases_reported: text.replace(/[^0-9]/g, '') })}
                onFocus={() => setFocusedField('cases')}
                onBlur={() => setFocusedField(null)}
                keyboardType="numeric"
              />

              <Text style={[styles.label, { color: colors.textSecondary }]}>Population Affected</Text>
              <TextInput
                style={getInputStyle('population')}
                placeholder="Approx. number"
                placeholderTextColor={colors.inputPlaceholderColor}
                value={formData.affected_population}
                onChangeText={(text) => setFormData({ ...formData, affected_population: text.replace(/[^0-9]/g, '') })}
                onFocus={() => setFocusedField('population')}
                onBlur={() => setFocusedField(null)}
                keyboardType="numeric"
              />

              <Text style={[styles.label, { color: colors.textSecondary }]}>Deaths (If Any)</Text>
              <TextInput
                style={getInputStyle('deaths')}
                placeholder="0"
                placeholderTextColor={colors.inputPlaceholderColor}
                value={formData.deaths_reported}
                onChangeText={(text) => setFormData({ ...formData, deaths_reported: text.replace(/[^0-9]/g, '') })}
                onFocus={() => setFocusedField('deaths')}
                onBlur={() => setFocusedField(null)}
                keyboardType="numeric"
              />

              <Text style={[styles.label, { color: colors.textSecondary }]}>Immediate Actions Recommended</Text>
              <Text style={[styles.help, { color: colors.textSecondary }]}>
                For field staff — short lines also join the poster's do-list
              </Text>
              <TextInput
                style={getTextAreaStyle('actions')}
                placeholder="What immediate steps should be taken?"
                placeholderTextColor={colors.inputPlaceholderColor}
                value={formData.immediate_actions}
                onChangeText={(text) => setFormData({ ...formData, immediate_actions: text })}
                onFocus={() => setFocusedField('actions')}
                onBlur={() => setFocusedField(null)}
                multiline
                numberOfLines={3}
              />

              <Text style={[styles.label, { color: colors.textSecondary }]}>Emergency Helpline</Text>
              <TextInput
                style={getInputStyle('emergency_helpline')}
                placeholder="e.g., 108"
                placeholderTextColor={colors.inputPlaceholderColor}
                value={formData.emergency_helpline}
                onChangeText={(text) => setFormData({ ...formData, emergency_helpline: text.replace(/[^0-9]/g, '') })}
                onFocus={() => setFocusedField('emergency_helpline')}
                onBlur={() => setFocusedField(null)}
                keyboardType="phone-pad"
                maxLength={15}
              />
            </View>
          )}
        </View>

        {/* ═══ LIVE POSTER PREVIEW — the composer IS the poster (B·03) ═══ */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: colors.textSecondary }]}>
            Live poster preview
          </Text>

          {/* Severity pill row — word + shape, never color alone */}
          <View style={styles.previewPillRow}>
            <StatusBadge status={formData.urgency_level} type="severity" size="medium" />
            <Text style={[styles.previewTypeText, { color: colors.textTertiary }]} maxFontSizeMultiplier={1.3}>
              {formData.alert_type.replace(/_/g, ' ').toUpperCase()}
            </Text>
          </View>

          {/* THE POSTER — full-strength 2px ink border, same anatomy the
              field worker sees in AllAlertsScreen's B·03 detail */}
          <View style={[styles.poster, { borderColor: colors.text, backgroundColor: colors.card }]}>
            {previewHindi ? (
              <>
                <Text
                  style={[styles.posterDirective, styles.posterDirectiveHindi, { color: colors.text }]}
                  maxFontSizeMultiplier={1.3}
                >
                  {previewHindi}
                </Text>
                <Text
                  style={[
                    styles.posterEnglish,
                    { color: previewTitle ? colors.text : colors.textTertiary },
                  ]}
                  maxFontSizeMultiplier={1.3}
                >
                  {previewTitle || 'English directive appears here'}
                </Text>
              </>
            ) : (
              <Text
                style={[
                  styles.posterDirective,
                  styles.posterDirectiveLatin,
                  { color: previewTitle ? colors.text : colors.textTertiary },
                ]}
                maxFontSizeMultiplier={1.3}
              >
                {previewTitle || 'Your directive appears here'}
              </Text>
            )}

            <Text
              style={[
                styles.posterBody,
                { color: previewDescription ? colors.textSecondary : colors.textTertiary },
              ]}
            >
              {previewDescription || 'What is happening appears here.'}
            </Text>

            <View style={styles.stepsBlock}>
              <Text
                style={[
                  styles.stepsHeading,
                  { color: previewSteps.length > 0 ? colors.text : colors.textTertiary },
                ]}
                maxFontSizeMultiplier={1.3}
              >
                {previewSteps.length > 0 ? stepsHeading(previewSteps.length) : 'DO THESE THREE THINGS'}
              </Text>
              {previewSteps.length > 0 ? (
                previewSteps.map((step, i) => (
                  <View key={i} style={styles.stepRow}>
                    <View style={[styles.stepNum, { borderColor: colors.text }]}>
                      <Text style={[styles.stepNumText, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                        {i + 1}
                      </Text>
                    </View>
                    <Text style={[styles.stepText, { color: colors.text }]}>{step}</Text>
                  </View>
                ))
              ) : (
                <Text style={[styles.posterBody, styles.stepsPlaceholder, { color: colors.textTertiary }]}>
                  Your numbered steps appear here.
                </Text>
              )}
            </View>

            <View style={[styles.helplineRow, { borderTopColor: colors.borderStrong }]}>
              {previewPhone ? (
                <>
                  <View style={styles.helplineBody}>
                    <Text style={[styles.helplinePhone, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                      {previewPhone}
                    </Text>
                    <Text style={[styles.helplineMeta, { color: colors.textSecondary }]} numberOfLines={1}>
                      {previewPerson ? `${previewPerson} · helpline` : 'health helpline'}
                    </Text>
                  </View>
                  {/* Static in the preview — the real poster's Call button */}
                  <View style={[styles.callBtn, { backgroundColor: colors.primary }]}>
                    <Ionicons name="call" size={16} color={colors.onPrimary} />
                    <Text style={[styles.callBtnText, { color: colors.onPrimary }]} maxFontSizeMultiplier={1.3}>
                      Call
                    </Text>
                  </View>
                </>
              ) : (
                <Text style={[styles.helplineMeta, { color: colors.textTertiary }]}>
                  Helpline number appears here.
                </Text>
              )}
            </View>

            {/* Provenance — disease taxonomy is literally the last line */}
            <Text style={[styles.posterProvenance, { color: colors.textTertiary }]} maxFontSizeMultiplier={1.3}>
              Preview — how field workers will see it
              {previewDisease ? ` · ${previewDisease}` : ''}
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* NEW-01 — persistence that is NOT working says so. A silent read
          failure looks exactly like "you have no unfinished alert". */}
      <DraftStorageNotice issue={draft.storageIssue} onRetry={draft.retryStorage} />

      {/* One-Hand Action Bar */}
      <View style={[styles.actionBar, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
        <Pressable
          onPress={handleCancelPress}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.cancelLink,
            { backgroundColor: pressed ? colors.surfaceVariant : colors.surface },
          ]}
        >
          <Text style={[styles.cancelText, { color: colors.textSecondary }]}>Cancel</Text>
        </Pressable>
        <Pressable
          onPress={handleSubmit}
          disabled={loading}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.submitBtn,
            {
              backgroundColor: pressed ? colors.primaryDark : colors.primary,
              opacity: loading ? 0.4 : 1,
            },
          ]}
        >
          <Text style={[styles.submitText, { color: colors.onPrimary }]}>
            {loading ? 'Sending…' : 'Send Alert'}
          </Text>
        </Pressable>
      </View>

      {/* Submission Modal */}
      <SubmissionModal
        visible={modalVisible}
        type={modalType}
        title={modalType === 'success' ? (isAsha ? 'Alert Submitted' : 'Alert Sent') : 'Alert Failed'}
        message={modalMessage}
        onClose={handleModalClose}
        onRetry={modalType === 'error' ? handleSubmit : undefined}
      />

      {/* NEW-01 — an unfinished alert found on this phone, offered not applied */}
      <RestoreDraftSheet
        visible={!!draft.offered}
        savedAt={draft.offeredAt}
        onRestore={applyDraft}
        onStartFresh={draft.dismiss}
        onRequestClose={requestClose}
      />

      {/* BRK-14 — the guard between Back and a lost alert */}
      <DiscardChangesSheet
        visible={confirmExit}
        onKeepEditing={() => setConfirmExit(false)}
        onDiscard={discardAndLeave}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  // Header — flat band, no radius, no gradient
  // Rendered inside MainApp's SafeAreaView — no status-bar inset re-added here.
  header: { paddingTop: spacing.xl, paddingBottom: spacing.md, paddingHorizontal: spacing.lg },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 48, alignSelf: 'flex-start', paddingRight: spacing.md },
  backText: { fontSize: 16, fontWeight: '500' },
  headerTitle: { fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: -0.4 },
  headerSubtitle: { fontSize: 15, lineHeight: 22, fontWeight: '500', marginTop: 2 },
  content: { flex: 1 },
  contentContainer: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  section: { marginTop: spacing.xl },
  sectionLabel: {
    fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.6,
    textTransform: 'uppercase', marginBottom: spacing.md,
  },
  sectionDesc: { fontSize: 13, lineHeight: 18, fontWeight: '500', marginBottom: spacing.md, marginTop: -4 },
  label: {
    fontSize: 13, lineHeight: 18, fontWeight: '700', letterSpacing: 0.5,
    textTransform: 'uppercase', marginBottom: 6, marginTop: spacing.lg,
  },
  // Field help — sits between the label and its input
  help: { fontSize: 13, lineHeight: 18, fontWeight: '400', marginBottom: 6, marginTop: -2 },
  input: { minHeight: 52, borderRadius: radii.md, paddingHorizontal: spacing.lg, paddingVertical: 14, fontSize: 15 },
  textArea: { minHeight: 100, textAlignVertical: 'top' },
  // Devanagari-friendly — bigger glyphs, extra vertical headroom for matras
  hindiInput: { minHeight: 56, fontSize: 18 },
  // THREE THINGS TO DO — numbered short inputs
  stepInputRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.md },
  stepInputNum: {
    width: 28, height: 28, borderRadius: 14, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  stepInputNumText: { fontSize: 12, lineHeight: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  stepInput: { flex: 1 },
  // Selection chips — 44dp, pill, solid fill + checkmark when selected
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chipScrollContent: { gap: spacing.sm, paddingVertical: spacing.xs },
  chip: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    minHeight: 44, borderRadius: radii.pill, borderWidth: 1.5, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
  },
  chipLabel: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  hintText: { fontSize: 13, lineHeight: 18, fontWeight: '500', marginTop: spacing.sm },
  // Inline field errors
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  errorText: { fontSize: 13, lineHeight: 18, fontWeight: '600', flex: 1 },
  // DETAILS · optional — collapsed disclosure, 48dp target
  detailsToggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    minHeight: 48, borderRadius: radii.md, borderWidth: 1.5,
    paddingHorizontal: spacing.lg,
  },
  detailsToggleLabel: { marginBottom: 0 },
  detailsDesc: { marginTop: spacing.sm, marginBottom: 0 },

  /* ── LIVE POSTER PREVIEW — mirrors AllAlertsScreen's B·03 styles ── */
  previewPillRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md, flexWrap: 'wrap' },
  previewTypeText: { fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.6 },
  poster: { borderWidth: 2, borderRadius: radii.md, padding: spacing.lg },
  posterDirective: { fontSize: 24, fontWeight: '700', letterSpacing: -0.3 },
  // Devanagari gets ~1.4× line-height headroom; Latin sits tighter
  posterDirectiveHindi: { lineHeight: 34 },
  posterDirectiveLatin: { lineHeight: 30 },
  posterEnglish: { fontSize: 17, lineHeight: 22, fontWeight: '600', marginTop: spacing.xs },
  posterBody: { fontSize: 15, lineHeight: 22, fontWeight: '400', marginTop: spacing.md },
  stepsBlock: { marginTop: spacing.lg },
  stepsHeading: { fontSize: 12, lineHeight: 16, fontWeight: '700', letterSpacing: 0.6, marginBottom: spacing.sm },
  stepsPlaceholder: { marginTop: 0 },
  stepRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start', marginTop: spacing.sm },
  stepNum: {
    width: 24, height: 24, borderRadius: 12, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  stepNumText: { fontSize: 12, lineHeight: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  stepText: { flex: 1, fontSize: 15, lineHeight: 22, fontWeight: '600' },
  helplineRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    borderTopWidth: 1, marginTop: spacing.lg, paddingTop: spacing.lg,
  },
  helplineBody: { flex: 1 },
  helplinePhone: { fontSize: 20, lineHeight: 26, fontWeight: '600', fontVariant: ['tabular-nums'] },
  helplineMeta: { fontSize: 13, lineHeight: 18, fontWeight: '500', marginTop: 1 },
  callBtn: {
    minHeight: 48, minWidth: 88, borderRadius: radii.md,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm, paddingHorizontal: spacing.lg,
  },
  callBtnText: { fontSize: 15, lineHeight: 22, fontWeight: '700' },
  posterProvenance: { fontSize: 12, lineHeight: 16, fontWeight: '500', marginTop: spacing.lg },

  // One-Hand Action Bar
  actionBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderTopWidth: 1,
  },
  cancelLink: { minWidth: 88, minHeight: 48, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 16, fontWeight: '700' },
  submitBtn: { flex: 1, minHeight: 56, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  submitText: { fontSize: 16, fontWeight: '700' },
});

export default AlertForm;
