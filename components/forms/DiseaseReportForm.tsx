// =====================================================
// DISEASE REPORT FORM — Bharosa Flow A·02 / A·03 / A·04
// Two-step wizard: chips + steppers (no typing on step 1),
// symptoms + GPS + save on step 2, then a confirmation
// state that celebrates the save. Offline is a place,
// not an error — queued state wears amber, never red.
// Preserves the exact existing submission payload +
// offline queue via diseaseReportsService.create().
// =====================================================
import React, { useEffect, useImperativeHandle, useRef, useState } from 'react';
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
import { useNetInfo } from '@react-native-community/netinfo';
import { useTranslation } from 'react-i18next';
import { useTheme, getSeverityColor, spacing, radii, Theme } from '../../lib/ThemeContext';
import { diseaseReportsService } from '../../lib/services/diseaseReports';
import { useFormDraft, FormExitHandle } from '../../lib/useFormDraft';
import { DiscardChangesSheet, RestoreDraftSheet, DraftStorageNotice } from '../../lib/FormGuardSheets';
import { SubmissionModal } from '../shared';
import { LocationField } from '../../src/components/LocationField';
import { DiseaseReport, DiseaseType, Profile, Severity, TreatmentStatus } from '../../types';

interface DiseaseReportFormProps {
  onSuccess: () => void;
  onCancel: () => void;
  /**
   * A·06 refile flow — prefill the wizard from the user's earlier (rejected)
   * report. Submission still files a brand-new report; the old row is never
   * mutated.
   */
  refillReportId?: string;
  /** Scopes the autosaved draft to this worker — a shared handset must not leak drafts. */
  profile?: Profile;
  /** BRK-14 — MainApp routes the Android hardware back press through here. */
  exitRef?: React.Ref<FormExitHandle>;
}

// ── Vocabulary ───────────────────────────────────────────────────────────────

const DISEASE_OPTIONS = [
  'Diarrhea',
  'Cholera',
  'Typhoid',
  'Dengue',
  'Malaria',
  'Jaundice',
  'Other…',
] as const;

// Taxonomy mapping is the system's job, not hers — the payload keeps the
// existing disease_type column filled from the chip she picked.
const DISEASE_TYPE_MAP: Record<string, DiseaseType> = {
  Diarrhea: 'waterborne',
  Cholera: 'waterborne',
  Typhoid: 'waterborne',
  Jaundice: 'waterborne',
  Dengue: 'vector',
  Malaria: 'vector',
};

const SYMPTOM_OPTIONS = [
  'Loose motion',
  'Vomiting',
  'Fever',
  'Weakness',
  'Stomach pain',
] as const;

const SEVERITY_LEVELS: Array<{ label: string; value: Severity }> = [
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
  { label: 'Critical', value: 'critical' },
];

// ── Pictograms — recognition must not depend on reading ──────────────────────
// Low-literacy support: every selection chip pairs a small Ionicons pictogram
// WITH its word (never replacing it — labels stay, i18n untouched). Every
// glyph name below is verified against the Ionicons glyphmap; a bad name
// renders '?'. Ionicons only, outline variants at rest.

const DISEASE_ICONS: Record<(typeof DISEASE_OPTIONS)[number], keyof typeof Ionicons.glyphMap> = {
  Diarrhea: 'water-outline',        // watery — single drop
  Cholera: 'rainy-outline',         // profuse watery purging — many drops
  Typhoid: 'thermometer-outline',   // sustained fever
  Dengue: 'bug-outline',            // mosquito-borne
  Malaria: 'moon-outline',          // night-biting mosquito
  Jaundice: 'eye-outline',          // yellow eyes — classic recognition sign
  'Other…': 'help-circle-outline',
};

const SYMPTOM_ICONS: Record<(typeof SYMPTOM_OPTIONS)[number], keyof typeof Ionicons.glyphMap> = {
  'Loose motion': 'water-outline',        // watery
  Vomiting: 'arrow-up-circle-outline',    // coming up
  Fever: 'thermometer-outline',
  Weakness: 'battery-dead-outline',       // empty battery — no energy
  'Stomach pain': 'sad-outline',          // pain face (pain-scale convention)
};

// No per-level glyph ladder exists in StatusBadge (only filled-critical pairs
// with 'warning'), so the chips use the alert/triangle family scaled by
// severity — topping out at the same filled 'warning' critical wears on its
// StatusBadge pill. Filled-at-rest is critical's privilege alone.
const SEVERITY_ICONS: Record<Severity, keyof typeof Ionicons.glyphMap> = {
  low: 'information-circle-outline',
  medium: 'alert-circle-outline',
  high: 'warning-outline',
  critical: 'warning',
};

// ── Local building blocks ────────────────────────────────────────────────────

const SelectChip: React.FC<{
  label: string;
  selected: boolean;
  onPress: () => void;
  colors: Theme;
  /** Leading pictogram — pairs with the word so recognition never depends on reading. */
  icon?: keyof typeof Ionicons.glyphMap;
  fill?: string;
  selectedLabelColor?: string;
  disabled?: boolean;
}> = ({ label, selected, onPress, colors, icon, fill, selectedLabelColor, disabled = false }) => {
  const bg = fill ?? colors.primary;
  const labelColor = selectedLabelColor ?? colors.onPrimary;
  // The pictogram inherits the label color — selection stays conveyed by
  // solid fill + checkmark + label, never by icon tint alone.
  const contentColor = selected ? labelColor : colors.text;
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? bg : pressed && !disabled ? colors.cardHover : colors.card,
          borderColor: selected ? bg : colors.border,
          opacity: disabled ? 0.4 : 1,
        },
      ]}
    >
      {selected && <Ionicons name="checkmark" size={16} color={labelColor} />}
      {icon && <Ionicons name={icon} size={18} color={contentColor} />}
      <Text style={[styles.chipLabel, { color: contentColor }]}>
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

/** − / count / + stepper. Buttons are 48dp — thumb-sized, can't mistype. */
const CountStepper: React.FC<{
  label: string;
  value: number;
  min: number;
  onChange: (next: number) => void;
  colors: Theme;
  accessibilityUnit: string;
}> = ({ label, value, min, onChange, colors, accessibilityUnit }) => (
  <View style={styles.stepperBlock}>
    <Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text>
    <View style={styles.stepperRow}>
      <Pressable
        onPress={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        accessibilityRole="button"
        accessibilityLabel={`Decrease ${accessibilityUnit}`}
        style={({ pressed }) => [
          styles.stepperBtn,
          {
            backgroundColor: pressed ? colors.cardHover : colors.card,
            borderColor: colors.inputBorder,
            opacity: value <= min ? 0.4 : 1,
          },
        ]}
      >
        <Ionicons name="remove" size={24} color={colors.text} />
      </Pressable>
      <Text
        style={[styles.stepperCount, { color: colors.text }]}
        accessibilityLabel={`${label}: ${value}`}
        maxFontSizeMultiplier={1.3}
      >
        {value}
      </Text>
      <Pressable
        onPress={() => onChange(Math.min(9999, value + 1))}
        accessibilityRole="button"
        accessibilityLabel={`Increase ${accessibilityUnit}`}
        style={({ pressed }) => [
          styles.stepperBtn,
          {
            backgroundColor: pressed ? colors.cardHover : colors.card,
            borderColor: colors.inputBorder,
          },
        ]}
      >
        <Ionicons name="add" size={24} color={colors.text} />
      </Pressable>
    </View>
  </View>
);

// ── Component ────────────────────────────────────────────────────────────────

export const DiseaseReportForm: React.FC<DiseaseReportFormProps> = ({
  onSuccess,
  onCancel,
  refillReportId,
  profile,
  exitRef,
}) => {
  const { colors, reduceMotion } = useTheme();
  const { t } = useTranslation();
  const netInfo = useNetInfo();
  // Tolerant null check — isInternetReachable === null (no probe yet) is online.
  const isOffline =
    netInfo.isConnected === false || netInfo.isInternetReachable === false;

  const [step, setStep] = useState<1 | 2>(1);
  const [loading, setLoading] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Error modal only — success renders the A·04 confirmation state instead.
  const [errorModalVisible, setErrorModalVisible] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // A·04 confirmation state — replaces the form after save.
  const [savedResult, setSavedResult] = useState<{
    queued: boolean;
    savedAt: Date;
    diseaseName: string;
    casesCount: number;
    deathsCount: number;
    severity: Severity;
    locationName: string;
    district: string;
  } | null>(null);

  // Step 1 — which sickness, counts, severity
  const [disease, setDisease] = useState('');
  const [customDisease, setCustomDisease] = useState('');
  const [casesCount, setCasesCount] = useState(1);
  const [deathsCount, setDeathsCount] = useState(0);
  const [severity, setSeverity] = useState<Severity>('medium');

  // Step 2 — symptoms, location, notes
  const [selectedSymptoms, setSelectedSymptoms] = useState<string[]>([]);
  const [otherSymptoms, setOtherSymptoms] = useState('');
  const [notes, setNotes] = useState('');
  const [location, setLocation] = useState({
    latitude: null as number | null,
    longitude: null as number | null,
    location_name: '',
    district: '',
    state: '',
  });

  // ── A·06 — refile context: fetch the rejected report once, prefill ──
  const [refillLoading, setRefillLoading] = useState(!!refillReportId);
  const [refillError, setRefillError] = useState<string | null>(null);
  const [refillInfo, setRefillInfo] = useState<{ shortId: string; reason: string | null } | null>(null);

  // ── NEW-01 / BRK-14 — draft autosave + dirty guard ─────────────────────────
  // The wizard holds its state as a dozen useState hooks; the hook wants one
  // plain snapshot, so it gets one. The refile context carries its OWN draft
  // key: a draft saved while refiling report X belongs to report X and can
  // never be offered on top of a different refile prefill, or on a fresh form.
  // One idempotency key per filling-in, carried INSIDE the draft snapshot.
  //
  // This is what stops a restored draft filing the report twice. On one bar of
  // signal the insert can commit server-side while the response is lost: the
  // form sees a failure and keeps the draft, she restores it and sends again.
  // With a key that is stable across that whole sequence, the second send
  // collides with the row already inserted and ignoreDuplicates makes it a
  // no-op. A key minted at send time — which is what the service used to do
  // unconditionally — can never collide, so the upsert deduplicated nothing.
  //
  // It lives in draftValues rather than a ref precisely so it survives the
  // save/restore round trip; a ref would be regenerated on remount, which is
  // exactly when the duplicate happens. A new blank form gets a new key, so
  // two genuinely different reports never collide with each other.
  const [submitKey, setSubmitKey] = useState(
    () => `dr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  );

  const draftValues = {
    step,
    disease,
    customDisease,
    casesCount,
    deathsCount,
    severity,
    selectedSymptoms,
    otherSymptoms,
    notes,
    location,
    submitKey,
  };

  const draft = useFormDraft({
    formKey: refillReportId ? `disease-report:refile:${refillReportId}` : 'disease-report',
    userId: profile?.id,
    values: draftValues,
    // Nothing to autosave once it is saved, and nothing worth comparing while
    // the refile prefill is still landing.
    enabled: !savedResult && !refillLoading,
  });

  const [confirmExit, setConfirmExit] = useState(false);

  const applyDraft = () => {
    const values = draft.restore();
    if (!values) return;
    // Restore field by field, and NEVER trust a field to be present.
    //
    // A draft is written by whichever build was installed at the time. If a
    // later build adds a field to draftValues above, every draft already on
    // the phone lacks it — and DRAFT_VERSION is a hand-maintained constant
    // that nobody remembers to bump. Assigning straight from the draft turned
    // a missing number into NaN (Math.max(1, undefined)), which reached the
    // submit payload as cases_count and serialised to null, and turned a
    // missing string into undefined, which flips a controlled TextInput to
    // uncontrolled mid-session.
    //
    // The other three forms merge over live state ({...prev, ...values}); this
    // one is a wizard with a dozen separate hooks, so each is guarded here
    // instead. Falling back to what is already on screen means a draft from an
    // older build restores what it knows and leaves the rest alone.
    const str = (v: unknown, fallback: string): string =>
      typeof v === 'string' ? v : fallback;
    const num = (v: unknown, fallback: number, min: number): number =>
      typeof v === 'number' && Number.isFinite(v) ? Math.max(min, v) : fallback;

    // Restoring the ORIGINAL key is the whole point: a resend after a lost
    // response must collide with the row that may already have committed.
    if (typeof values.submitKey === 'string' && values.submitKey) {
      setSubmitKey(values.submitKey);
    }
    setStep(values.step === 2 ? 2 : 1);
    setDisease((prev) => str(values.disease, prev));
    setCustomDisease((prev) => str(values.customDisease, prev));
    setCasesCount((prev) => num(values.casesCount, prev, 1));
    setDeathsCount((prev) => num(values.deathsCount, prev, 0));
    if (SEVERITY_LEVELS.some((level) => level.value === values.severity)) {
      setSeverity(values.severity);
    }
    if (Array.isArray(values.selectedSymptoms)) {
      setSelectedSymptoms(values.selectedSymptoms.filter((s: unknown) => typeof s === 'string'));
    }
    setOtherSymptoms((prev) => str(values.otherSymptoms, prev));
    setNotes((prev) => str(values.notes, prev));
    if (values.location && typeof values.location === 'object') {
      setLocation((prev) => ({ ...prev, ...values.location }));
    }
    setErrors({});
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  const loadRefill = async () => {
    if (!refillReportId) return;
    setRefillLoading(true);
    setRefillError(null);
    const res = await diseaseReportsService.getById(refillReportId);
    if (res.error || !res.data) {
      setRefillError("Couldn't load the earlier report — you can still file a fresh one.");
      setRefillLoading(false);
      // Nothing was prefilled, but the guard must arm against the form as it
      // now stands rather than against a stale first-render snapshot.
      draft.markPristine();
      return;
    }
    const r = res.data as DiseaseReport & { rejection_reason?: string | null };

    // Disease chip — pick the matching chip, else Other… + typed name.
    const knownDisease = DISEASE_OPTIONS.find(
      (o) => o !== 'Other…' && o.toLowerCase() === (r.disease_name ?? '').trim().toLowerCase()
    );
    if (knownDisease) {
      setDisease(knownDisease);
      setCustomDisease('');
    } else if ((r.disease_name ?? '').trim()) {
      setDisease('Other…');
      setCustomDisease(r.disease_name.trim());
    }

    setCasesCount(Math.max(1, r.cases_count ?? 1));
    setDeathsCount(Math.max(0, r.deaths_count ?? 0));
    if (r.severity) setSeverity(r.severity);

    // Symptoms — split the stored text back into chips + free text.
    const parts = String(r.symptoms ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const canonical: string[] = [];
    const others: string[] = [];
    for (const p of parts) {
      const match = SYMPTOM_OPTIONS.find((o) => o.toLowerCase() === p.toLowerCase());
      if (match) {
        if (!canonical.includes(match)) canonical.push(match);
      } else {
        others.push(p);
      }
    }
    setSelectedSymptoms(canonical);
    setOtherSymptoms(others.join(', '));

    setNotes(r.notes ?? '');
    setLocation({
      latitude: r.latitude ?? null,
      longitude: r.longitude ?? null,
      location_name: r.location_name ?? '',
      district: r.district ?? '',
      state: r.state ?? '',
    });

    setRefillInfo({
      shortId: String(r.id ?? '').slice(0, 8).toUpperCase(),
      reason:
        typeof r.rejection_reason === 'string' && r.rejection_reason.trim().length > 0
          ? r.rejection_reason.trim()
          : null,
    });
    setRefillLoading(false);
    // The prefill is the machine typing, not her — it must not read as unsaved
    // work, and it becomes the baseline any real edit is measured against.
    draft.markPristine();
  };

  useEffect(() => {
    loadRefill();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refillReportId]);

  const scrollRef = useRef<ScrollView>(null);
  const fieldYRef = useRef<Record<string, number>>({});

  const onFieldLayout = (field: string) => (e: LayoutChangeEvent) => {
    fieldYRef.current[field] = e.nativeEvent.layout.y;
  };
  const scrollToField = (field: string) => {
    const y = fieldYRef.current[field] ?? 0;
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

  // Rule: deaths > 0 auto-raises severity to at least High.
  const deathsLockSeverity = deathsCount > 0;
  const handleDeathsChange = (next: number) => {
    setDeathsCount(next);
    if (next > 0 && (severity === 'low' || severity === 'medium')) {
      setSeverity('high');
    }
  };

  const toggleSymptom = (symptom: string) => {
    setSelectedSymptoms((prev) =>
      prev.includes(symptom) ? prev.filter((s) => s !== symptom) : [...prev, symptom]
    );
  };

  const resolvedDiseaseName =
    disease === 'Other…' ? customDisease.trim() : disease;

  // ── Cluster / duplicate awareness (ROADMAP item 4) ─────────────────────────
  // Every worker is an early-warning sensor: once disease + district are both
  // known (district resolves on Step 2 via GPS or typing), quietly ask the
  // server "any similar reports here this week?". The answer INFORMS — it
  // never blocks the save, and a failed lookup stays silent. One query per
  // disease+district combination (cached), debounced so district keystrokes
  // don't fire requests.
  const [cluster, setCluster] = useState<{
    key: string;
    count: number;
    totalCases: number;
    district: string;
  } | null>(null);
  const [clusterDismissedKey, setClusterDismissedKey] = useState<string | null>(null);
  const clusterCacheRef = useRef<
    Map<string, { count: number; totalCases: number } | 'pending'>
  >(new Map());

  const clusterDistrict = location.district.trim();
  useEffect(() => {
    if (step !== 2) return;
    const diseaseName = resolvedDiseaseName.trim();
    if (!diseaseName || !clusterDistrict) return;

    const key = `${clusterDistrict.toLowerCase()}|${diseaseName.toLowerCase()}`;
    let cancelled = false;

    const apply = (result: { count: number; totalCases: number }) => {
      setCluster(
        result.count > 0
          ? { key, count: result.count, totalCases: result.totalCases, district: clusterDistrict }
          : null
      );
    };

    // Debounce — the district field is hand-editable on Step 2.
    const timer = setTimeout(async () => {
      const cached = clusterCacheRef.current.get(key);
      if (cached === 'pending') return;
      if (cached) {
        apply(cached);
        return;
      }
      clusterCacheRef.current.set(key, 'pending');
      const res = await diseaseReportsService.nearbyRecentReports({
        diseaseName,
        district: clusterDistrict,
      });
      const result =
        res.error || !res.data
          ? // Silent on failure — cache the miss so we never hammer the network.
            { count: 0, totalCases: 0 }
          : { count: res.data.count, totalCases: res.data.totalCases };
      clusterCacheRef.current.set(key, result);
      if (!cancelled) apply(result);
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [step, resolvedDiseaseName, clusterDistrict]);

  const clusterVisible =
    step === 2 && !!cluster && cluster.count > 0 && cluster.key !== clusterDismissedKey;

  // Display-only glossary lookup — chips and the payload keep the English
  // identifiers; Hindi renders dual-script ("दस्त (Diarrhea)") per Bharosa.
  const diseaseDisplay = (name: string): string =>
    (DISEASE_OPTIONS as readonly string[]).includes(name) && name !== 'Other…'
      ? t(`diseaseForm.diseases.${name}`)
      : name;

  // ── Step navigation ────────────────────────────────────────────────────────

  const handleContinue = () => {
    const errs: Record<string, string> = {};
    if (!resolvedDiseaseName) {
      errs.disease_name =
        disease === 'Other…'
          ? t('diseaseForm.errTypeSickness')
          : t('diseaseForm.errPickSickness');
    }
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      scrollToField('disease_name');
      return;
    }
    setStep(2);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  const stepBackToOne = () => {
    setStep(1);
    setErrors({});
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  /** Cancel means "leave", from any step — so it always faces the dirty guard. */
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

  // BRK-14 — "back" in this app's own terms, used by the header Back button
  // AND by MainApp's hardware-back listener.
  //
  // The two are the same code path for every NON-modal state, which is the
  // claim that matters. They are not identical while a Modal is up, and the
  // review was right to narrow it: on Android a visible Modal's Dialog answers
  // the back press through its own onRequestClose before any BackHandler
  // listener runs, and the header chevron is behind that Modal. So the
  // errorModalVisible and confirmExit rungs below are unreachable from the
  // hardware key — the discard sheet answers back itself (onRequestClose ->
  // onKeepEditing) and the error modal answers its own. They stay as the
  // correct answer for any caller that is NOT a Modal (react-native-web
  // renders Modal inline), not because a back press reaches them today.
  //
  // The rungs that ARE live: the saved-confirmation state and the restore
  // sheet, which routes its onRequestClose here on purpose.
  const requestClose = () => {
    if (savedResult) {
      // Already saved; back from the confirmation is simply "done".
      onSuccess();
      return;
    }
    if (errorModalVisible) {
      setErrorModalVisible(false);
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
    if (step === 2) {
      stepBackToOne();
      return;
    }
    if (draft.dirty) {
      setConfirmExit(true);
      return;
    }
    onCancel();
  };

  useImperativeHandle(exitRef, () => ({ requestClose }));

  // ── Submit — exact existing payload + offline queue path ───────────────────

  const handleSubmit = async () => {
    const errs: Record<string, string> = {};
    if (
      !location.location_name.trim() ||
      !location.district.trim() ||
      !location.state
    ) {
      errs.location = t('diseaseForm.errLocation');
    }
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      scrollToField('location');
      return;
    }

    setLoading(true);
    try {
      const symptomsText = [...selectedSymptoms, otherSymptoms.trim()]
        .filter(Boolean)
        .join(', ');

      const { error, queued } = await diseaseReportsService.create({
        disease_name: resolvedDiseaseName,
        disease_type: DISEASE_TYPE_MAP[disease] ?? 'other',
        severity,
        symptoms: symptomsText,
        cases_count: casesCount,
        deaths_count: deathsCount,
        age_group: '',
        gender: '',
        location_name: location.location_name,
        latitude: location.latitude ?? undefined,
        longitude: location.longitude ?? undefined,
        district: location.district,
        state: location.state,
        treatment_status: 'pending' as TreatmentStatus,
        notes: notes.trim() || undefined,
        // Stable across retries and across a draft restore — see submitKey.
        client_idempotency_key: submitKey,
      });

      if (error) throw new Error(String(error));

      // Saved (or queued to sync) — the draft has done its job.
      draft.clear();

      setSavedResult({
        queued: !!queued,
        savedAt: new Date(),
        diseaseName: resolvedDiseaseName,
        casesCount,
        deathsCount,
        severity,
        locationName: location.location_name,
        district: location.district,
      });
    } catch (error: any) {
      console.error('Submit error:', error);
      const message = String(error?.message ?? error ?? '').trim();
      setErrorMessage(message || t('diseaseForm.errorFallback'));
      setErrorModalVisible(true);
    } finally {
      setLoading(false);
    }
  };

  const handleReportAnother = () => {
    // Keep location — she is likely still in the same village; GPS refreshes on mount.
    // A fresh report is no longer a refile — drop the amber context card.
    setRefillInfo(null);
    setRefillError(null);
    setSavedResult(null);
    setCluster(null);
    setClusterDismissedKey(null);
    setStep(1);
    setErrors({});
    setDisease('');
    setCustomDisease('');
    setCasesCount(1);
    setDeathsCount(0);
    setSeverity('medium');
    setSelectedSymptoms([]);
    setOtherSymptoms('');
    setNotes('');
    // A blank second report is not unsaved work — re-arm so leaving it
    // untouched stays silent and nothing empty gets autosaved as a draft.
    draft.markPristine();
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

  // ── A·04 — Confirmation state (replaces the form after save) ───────────────

  if (savedResult) {
    const queued = savedResult.queued;
    const severityLabel = t(`diseaseForm.severity.${savedResult.severity}`);
    const markColor = queued ? colors.warning : colors.success;
    const markBg = queued ? colors.warningBg : colors.successBg;
    const timeText = savedResult.savedAt.toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    });
    const nextSteps = [
      queued ? t('diseaseForm.nextQueued') : t('diseaseForm.nextSynced'),
      t('diseaseForm.nextReview'),
      t('diseaseForm.nextDecision'),
    ];

    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.confirmContainer}
          showsVerticalScrollIndicator={false}
        >
          {/* Big success mark — the save is celebrated as completion */}
          <View style={[styles.confirmMark, { backgroundColor: markBg }]}>
            <Ionicons
              name={queued ? 'checkmark-done' : 'checkmark'}
              size={56}
              color={markColor}
            />
          </View>

          <Text
            style={[styles.confirmTitle, { color: colors.text }]}
            maxFontSizeMultiplier={1.3}
            accessibilityRole="header"
          >
            {queued ? t('diseaseForm.confirmQueuedTitle') : t('diseaseForm.confirmSubmittedTitle')}
          </Text>
          <Text style={[styles.confirmBody, { color: colors.textSecondary }]}>
            {queued
              ? t('diseaseForm.confirmQueuedBody')
              : t('diseaseForm.confirmSubmittedBody')}
          </Text>

          {/* Summary card */}
          <View style={[styles.summaryCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.summaryTopRow}>
              <Text style={[styles.summaryTitle, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
                {diseaseDisplay(savedResult.diseaseName)} · {savedResult.casesCount} {t('diseaseForm.sickWord')} · {savedResult.deathsCount}{' '}
                {savedResult.deathsCount === 1 ? t('diseaseForm.deathOne') : t('diseaseForm.deathMany')}
              </Text>
              <View
                style={[
                  styles.statusPill,
                  { backgroundColor: queued ? colors.warningBg : colors.successBg },
                ]}
              >
                <Ionicons
                  name={queued ? 'time-outline' : 'checkmark-circle-outline'}
                  size={14}
                  color={queued ? colors.warning : colors.success}
                />
                <Text
                  style={[
                    styles.statusPillText,
                    { color: queued ? colors.warning : colors.success },
                  ]}
                >
                  {queued ? t('diseaseForm.pillQueued') : t('diseaseForm.pillSubmitted')}
                </Text>
              </View>
            </View>
            <Text style={[styles.summaryMeta, { color: colors.textSecondary }]}>
              {[savedResult.locationName, savedResult.district].filter(Boolean).join(', ')} ·{' '}
              {severityLabel} · {timeText}
            </Text>
          </View>

          {/* WHAT HAPPENS NEXT — the 1-2-3 strip */}
          <Text style={[styles.eyebrow, { color: colors.textSecondary }]}>
            {t('diseaseForm.whatNext')}
          </Text>
          <View style={[styles.stepsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {nextSteps.map((stepText, i) => (
              <View key={stepText} style={styles.nextStepRow}>
                <View
                  style={[
                    styles.nextStepNum,
                    {
                      backgroundColor: i === 0 ? markBg : colors.surfaceVariant,
                      borderColor: i === 0 ? markColor : colors.border,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.nextStepNumText,
                      { color: i === 0 ? markColor : colors.textSecondary },
                    ]}
                  >
                    {i + 1}
                  </Text>
                </View>
                <Text style={[styles.nextStepText, { color: colors.text }]}>
                  {stepText}
                </Text>
              </View>
            ))}
          </View>
        </ScrollView>

        {/* One-Hand Action Bar */}
        <View style={[styles.actionBar, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
          <Pressable
            onPress={handleReportAnother}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.secondaryBtn,
              {
                backgroundColor: pressed ? colors.surfaceVariant : colors.surface,
                borderColor: colors.inputBorder,
              },
            ]}
          >
            <Text style={[styles.secondaryBtnText, { color: colors.text }]}>
              {t('diseaseForm.reportAnother')}
            </Text>
          </Pressable>
          <Pressable
            onPress={onSuccess}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.submitBtn,
              { backgroundColor: pressed ? colors.primaryDark : colors.primary },
            ]}
          >
            <Text style={[styles.submitText, { color: colors.onPrimary }]}>{t('common.done')}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ── A·02 / A·03 — The two-step form ────────────────────────────────────────

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
          accessibilityLabel={step === 2 ? 'Back to step 1' : 'Go back'}
        >
          <Ionicons name="arrow-back" size={24} color={colors.text} />
          <Text style={[styles.backText, { color: colors.text }]}>{t('common.back')}</Text>
        </Pressable>
        <Text style={[styles.headerTitle, { color: colors.text }]} accessibilityRole="header">
          {t('diseaseForm.headerTitle')}
        </Text>
        <Text style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
          {step === 1 ? t('diseaseForm.step1') : t('diseaseForm.step2')}
        </Text>
      </View>

      {/* Offline banner — a place, not an error */}
      {isOffline && (
        <View
          style={[styles.offlineBanner, { backgroundColor: colors.offlineBg }]}
          accessibilityLiveRegion="polite"
        >
          <Ionicons name="cloud-offline-outline" size={18} color={colors.offline} />
          <Text style={[styles.offlineBannerText, { color: colors.offline }]}>
            {t('diseaseForm.offlineBanner')}
          </Text>
        </View>
      )}

      <ScrollView
        ref={scrollRef}
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {step === 1 ? (
          <>
            {/* ── A·06 — refile context card (amber: waiting on a fix, not wrong) ── */}
            {refillReportId && (
              refillLoading ? (
                <View
                  style={[styles.refileSkeleton, { backgroundColor: colors.skeleton }]}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                />
              ) : refillError ? (
                <View style={styles.refileErrorRow}>
                  <Ionicons name="information-circle-outline" size={16} color={colors.textSecondary} />
                  <Text style={[styles.refileErrorText, { color: colors.textSecondary }]}>
                    {refillError}
                  </Text>
                  <Pressable
                    onPress={loadRefill}
                    accessibilityRole="button"
                    accessibilityLabel="Retry loading the earlier report"
                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                  >
                    <Text style={[styles.refileRetry, { color: colors.primary }]}>Retry</Text>
                  </Pressable>
                </View>
              ) : refillInfo ? (
                <View
                  style={[styles.refileCard, { backgroundColor: colors.warningBg }]}
                  accessible
                  accessibilityLabel={`Refiling report ${refillInfo.shortId}. ${refillInfo.reason ?? 'The earlier report was not accepted.'}`}
                >
                  <View style={styles.refileHead}>
                    <Ionicons name="refresh-circle-outline" size={18} color={colors.warning} />
                    <Text style={[styles.refileEyebrow, { color: colors.warning }]} maxFontSizeMultiplier={1.3}>
                      {`REFILING #${refillInfo.shortId}`}
                    </Text>
                  </View>
                  <Text style={[styles.refileReason, { color: colors.text }]}>
                    {refillInfo.reason
                      ? `“${refillInfo.reason}”`
                      : 'The earlier report was not accepted — fix it below and save again.'}
                  </Text>
                  <Text style={[styles.refileMeta, { color: colors.textSecondary }]} maxFontSizeMultiplier={1.3}>
                    Saving files a new report — the earlier one stays unchanged.
                  </Text>
                </View>
              ) : null
            )}

            {/* Which sickness? */}
            <View style={styles.section} onLayout={onFieldLayout('disease_name')}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>{t('diseaseForm.whichSickness')}</Text>
              <Text style={[styles.helpText, { color: colors.textSecondary }]}>
                {t('diseaseForm.pickClosestHelp')}
              </Text>
              <View style={styles.chipWrap}>
                {DISEASE_OPTIONS.map((option) => (
                  <SelectChip
                    key={option}
                    label={t(`diseaseForm.diseases.${option}`)}
                    selected={disease === option}
                    onPress={() => {
                      setDisease(option);
                      clearError('disease_name');
                    }}
                    colors={colors}
                    icon={DISEASE_ICONS[option]}
                  />
                ))}
              </View>

              {disease === 'Other…' && (
                <>
                  <Text style={[styles.label, { color: colors.textSecondary }]}>
                    {t('diseaseForm.whatCalled')}
                  </Text>
                  <TextInput
                    style={getInputStyle('custom_disease')}
                    placeholder={t('diseaseForm.typeSicknessPlaceholder')}
                    placeholderTextColor={colors.inputPlaceholderColor}
                    value={customDisease}
                    onChangeText={(text) => {
                      setCustomDisease(text);
                      clearError('disease_name');
                    }}
                    onFocus={() => setFocusedField('custom_disease')}
                    onBlur={() => setFocusedField(null)}
                  />
                </>
              )}
              <FieldError message={errors.disease_name} colors={colors} />
            </View>

            {/* Counts — steppers, no typing */}
            <View style={styles.section}>
              <CountStepper
                label={t('diseaseForm.peopleSick')}
                value={casesCount}
                min={1}
                onChange={setCasesCount}
                colors={colors}
                accessibilityUnit="people sick"
              />
              <CountStepper
                label={t('diseaseForm.deaths')}
                value={deathsCount}
                min={0}
                onChange={handleDeathsChange}
                colors={colors}
                accessibilityUnit="deaths"
              />
            </View>

            {/* Severity */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                {t('diseaseForm.howSerious')}
              </Text>
              <View style={styles.chipWrap}>
                {SEVERITY_LEVELS.map((level) => {
                  const lockedOut =
                    deathsLockSeverity && (level.value === 'low' || level.value === 'medium');
                  return (
                    <SelectChip
                      key={level.value}
                      label={t(`diseaseForm.severity.${level.value}`)}
                      selected={severity === level.value}
                      onPress={() => setSeverity(level.value)}
                      colors={colors}
                      icon={SEVERITY_ICONS[level.value]}
                      fill={getSeverityColor(level.value, colors)}
                      selectedLabelColor={colors.textInverse}
                      disabled={lockedOut}
                    />
                  );
                })}
              </View>
              <Text style={[styles.helpText, { color: colors.textSecondary, marginTop: spacing.sm }]}>
                {t('diseaseForm.deathsRule')}
              </Text>
            </View>
          </>
        ) : (
          <>
            {/* Symptoms */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                {t('diseaseForm.symptomsSeen')}
              </Text>
              <View style={styles.chipWrap}>
                {SYMPTOM_OPTIONS.map((symptom) => (
                  <SelectChip
                    key={symptom}
                    label={t(`diseaseForm.symptoms.${symptom}`)}
                    selected={selectedSymptoms.includes(symptom)}
                    onPress={() => toggleSymptom(symptom)}
                    colors={colors}
                    icon={SYMPTOM_ICONS[symptom]}
                  />
                ))}
              </View>
              <Text style={[styles.label, { color: colors.textSecondary }]}>
                {t('diseaseForm.otherSymptomsLabel')}
              </Text>
              <TextInput
                style={getInputStyle('other_symptoms')}
                placeholder={t('diseaseForm.otherSymptomsPlaceholder')}
                placeholderTextColor={colors.inputPlaceholderColor}
                value={otherSymptoms}
                onChangeText={setOtherSymptoms}
                onFocus={() => setFocusedField('other_symptoms')}
                onBlur={() => setFocusedField(null)}
              />
            </View>

            {/* Location — GPS autofill */}
            <View style={styles.section} onLayout={onFieldLayout('location')}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                {t('diseaseForm.whereHappening')}
              </Text>
              <LocationField
                value={{
                  latitude: location.latitude,
                  longitude: location.longitude,
                  locationName: location.location_name,
                  district: location.district,
                  state: location.state,
                  formattedAddress: '',
                }}
                onChange={(loc) => {
                  // A location block that has only ever held machine-written
                  // values is not her work: re-arm the pristine mark so Back
                  // still closes silently.
                  //
                  // This used to test "was the location EMPTY before?", so only
                  // the very first fix counted as the machine typing. Tapping
                  // LocationField's "Re-fetch" on an already-located, otherwise
                  // untouched form flipped `dirty` on a coordinate that moved
                  // three metres, and Back then raised "Leave without saving?"
                  // over a report she had not written a word of — the
                  // tap-through-the-dialog training the guard exists to avoid.
                  //
                  // Telling the machine from her, exactly rather than by
                  // guesswork: LocationField spreads the current `value` for
                  // every hand edit (typing a village, typing a district,
                  // picking a registry suggestion, Skip GPS), and this form
                  // always passes formattedAddress: '' in that value — so a
                  // NON-EMPTY formattedAddress can only have come from
                  // LocationField's own GPS/geocode sync. Changed coordinates
                  // cover the second machine path, a fix whose reverse-geocode
                  // failed. Nothing she types satisfies either test.
                  const machineFilled =
                    !!loc.formattedAddress ||
                    loc.latitude !== location.latitude ||
                    loc.longitude !== location.longitude;
                  setLocation({
                    latitude: loc.latitude,
                    longitude: loc.longitude,
                    location_name: loc.locationName,
                    district: loc.district,
                    state: loc.state,
                  });
                  if (machineFilled && !draft.dirty) {
                    draft.markPristine();
                  }
                  if (loc.locationName && loc.district && loc.state) clearError('location');
                }}
                autoFetch={!refillReportId}
              />
              <Text style={[styles.helpText, { color: colors.textSecondary, marginTop: spacing.sm }]}>
                {t('diseaseForm.gpsHelp')}
              </Text>
              <FieldError message={errors.location} colors={colors} />
            </View>

            {/* Notes */}
            <View style={styles.section}>
              <Text style={[styles.sectionTitle, { color: colors.text }]}>
                {t('diseaseForm.notesLabel')}
              </Text>
              <TextInput
                style={[...getInputStyle('notes'), styles.textArea]}
                placeholder={t('diseaseForm.notesPlaceholder')}
                placeholderTextColor={colors.inputPlaceholderColor}
                value={notes}
                onChangeText={setNotes}
                onFocus={() => setFocusedField('notes')}
                onBlur={() => setFocusedField(null)}
                multiline
                numberOfLines={4}
              />
            </View>
          </>
        )}
      </ScrollView>

      {/* Cluster / duplicate awareness — informs, never blocks. Pinned above
          the submit area so it's seen without scrolling; dismissible. */}
      {clusterVisible && cluster && (
        <View
          style={[styles.clusterCard, { backgroundColor: colors.infoBg }]}
          accessibilityLiveRegion="polite"
        >
          <Ionicons name="pulse" size={20} color={colors.info} style={styles.clusterIcon} />
          <Text style={[styles.clusterText, { color: colors.info }]}>
            {cluster.count === 1
              ? t('diseaseForm.clusterOne', { district: cluster.district })
              : t('diseaseForm.clusterMany', {
                  n: cluster.count,
                  cases: cluster.totalCases,
                  district: cluster.district,
                })}
          </Text>
          <Pressable
            onPress={() => setClusterDismissedKey(cluster.key)}
            accessibilityRole="button"
            accessibilityLabel={t('diseaseForm.clusterDismiss')}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="close" size={18} color={colors.info} />
          </Pressable>
        </View>
      )}

      {/* NEW-01 — persistence that is NOT working says so. A silent read
          failure looks exactly like "you have no unfinished report". */}
      <DraftStorageNotice issue={draft.storageIssue} onRetry={draft.retryStorage} />

      {/* One-Hand Action Bar */}
      <View style={[styles.actionZone, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
        {step === 2 && (
          <Text style={[styles.saveCaption, { color: colors.textSecondary }]}>
            {t('diseaseForm.saveCaption')}
          </Text>
        )}
        <View style={styles.actionRow}>
          <Pressable
            onPress={handleCancelPress}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.cancelLink,
              { backgroundColor: pressed ? colors.surfaceVariant : colors.surface },
            ]}
          >
            <Text style={[styles.cancelText, { color: colors.textSecondary }]}>{t('common.cancel')}</Text>
          </Pressable>
          <Pressable
            onPress={step === 1 ? handleContinue : handleSubmit}
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
              {step === 1 ? t('diseaseForm.continue') : loading ? t('diseaseForm.saving') : t('diseaseForm.saveReport')}
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Error modal only — success is the A·04 confirmation state */}
      <SubmissionModal
        visible={errorModalVisible}
        type="error"
        title={t('diseaseForm.errorTitle')}
        message={errorMessage}
        onClose={() => setErrorModalVisible(false)}
        onRetry={handleSubmit}
      />

      {/* NEW-01 — an unfinished report found on this phone, offered not applied */}
      <RestoreDraftSheet
        visible={!!draft.offered}
        savedAt={draft.offeredAt}
        onRestore={applyDraft}
        onStartFresh={draft.dismiss}
        onRequestClose={requestClose}
      />

      {/* BRK-14 — the guard between Back and a lost report */}
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
  // Rendered inside MainApp's SafeAreaView — no status-bar inset re-added here.
  header: { paddingTop: spacing.xl, paddingBottom: spacing.md, paddingHorizontal: spacing.lg },
  backBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    minHeight: 48, alignSelf: 'flex-start', paddingRight: spacing.md,
  },
  backText: { fontSize: 16, fontWeight: '500' },
  headerTitle: { fontSize: 22, lineHeight: 30 /* ×1.35+ — Devanagari matras */, fontWeight: '800', letterSpacing: -0.4 },
  headerSubtitle: { fontSize: 13, lineHeight: 18, fontWeight: '600', marginTop: 2 },

  offlineBanner: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    minHeight: 44, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
  },
  offlineBannerText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '700' },

  content: { flex: 1 },
  contentContainer: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  section: { marginTop: spacing.xl },
  sectionTitle: { fontSize: 16, lineHeight: 22, fontWeight: '700', marginBottom: spacing.sm },
  helpText: { fontSize: 13, lineHeight: 18, fontWeight: '500', marginBottom: spacing.md },
  label: {
    fontSize: 13, lineHeight: 18, fontWeight: '700', letterSpacing: 0.5,
    textTransform: 'uppercase', marginBottom: 6, marginTop: spacing.lg,
  },
  input: {
    minHeight: 52, borderRadius: radii.md,
    paddingHorizontal: spacing.lg, paddingVertical: 14, fontSize: 15,
  },
  textArea: { minHeight: 100, textAlignVertical: 'top' },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    minHeight: 44, borderRadius: radii.pill, borderWidth: 1.5,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm,
  },
  chipLabel: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  errorText: { fontSize: 13, lineHeight: 18, fontWeight: '600', flex: 1 },

  /* ── A·06 refile context — amber card + quiet loading/error rows ── */
  refileCard: {
    borderRadius: radii.md, padding: spacing.lg, gap: spacing.xs, marginTop: spacing.xl,
  },
  refileHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  refileEyebrow: {
    fontSize: 12, lineHeight: 16, fontWeight: '800', letterSpacing: 0.6,
    textTransform: 'uppercase', flexShrink: 1,
  },
  refileReason: { fontSize: 13, lineHeight: 18, fontWeight: '500' },
  refileMeta: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
  refileSkeleton: { height: 72, borderRadius: radii.md, marginTop: spacing.xl },
  refileErrorRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.xl,
  },
  refileErrorText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '500' },
  refileRetry: { fontSize: 13, lineHeight: 18, fontWeight: '700' },

  /* Steppers */
  stepperBlock: { marginBottom: spacing.lg },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  stepperBtn: {
    width: 48, height: 48, borderRadius: radii.md, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  stepperCount: {
    minWidth: 72, textAlign: 'center',
    fontSize: 24, lineHeight: 28, fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },

  /* Cluster / duplicate awareness card — info tokens, never red */
  clusterCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    borderRadius: radii.md, padding: spacing.md,
    marginHorizontal: spacing.lg, marginBottom: spacing.sm,
  },
  clusterIcon: { marginTop: 1 },
  clusterText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '600' },

  /* One-Hand Action Bar */
  actionZone: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderTopWidth: 1 },
  saveCaption: {
    fontSize: 12, lineHeight: 17 /* ×1.35+ — Devanagari matras */, fontWeight: '600',
    textAlign: 'center', marginBottom: spacing.sm,
  },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  cancelLink: {
    minWidth: 88, minHeight: 48, borderRadius: radii.md,
    alignItems: 'center', justifyContent: 'center',
  },
  cancelText: { fontSize: 16, fontWeight: '700' },
  submitBtn: {
    flex: 1, minHeight: 56, borderRadius: radii.md,
    alignItems: 'center', justifyContent: 'center',
  },
  submitText: { fontSize: 16, fontWeight: '700' },
  actionBar: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderTopWidth: 1,
  },
  secondaryBtn: {
    flex: 1, minHeight: 56, borderRadius: radii.md, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  secondaryBtnText: { fontSize: 16, fontWeight: '700' },

  /* A·04 confirmation */
  confirmContainer: {
    paddingHorizontal: spacing.lg, paddingTop: spacing.xxl + spacing.xl,
    paddingBottom: spacing.xl, alignItems: 'stretch',
  },
  confirmMark: {
    width: 96, height: 96, borderRadius: radii.pill,
    alignItems: 'center', justifyContent: 'center', alignSelf: 'center',
    marginBottom: spacing.xl,
  },
  confirmTitle: {
    fontSize: 22, lineHeight: 30 /* ×1.35+ — Devanagari matras */, fontWeight: '800', letterSpacing: -0.4,
    textAlign: 'center', marginBottom: spacing.sm,
  },
  confirmBody: {
    fontSize: 15, lineHeight: 22, fontWeight: '500',
    textAlign: 'center', marginBottom: spacing.xl,
  },
  summaryCard: {
    borderRadius: radii.md, borderWidth: 1, padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  summaryTopRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    justifyContent: 'space-between', gap: spacing.sm,
  },
  summaryTitle: {
    flex: 1, fontSize: 15, lineHeight: 22, fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 6,
  },
  statusPillText: {
    fontSize: 12, lineHeight: 17 /* ×1.35+ — Devanagari matras */, fontWeight: '800',
    textTransform: 'uppercase', letterSpacing: 0.6,
  },
  summaryMeta: {
    fontSize: 13, lineHeight: 18, fontWeight: '500', marginTop: spacing.sm,
    fontVariant: ['tabular-nums'],
  },
  eyebrow: {
    fontSize: 12, lineHeight: 17 /* ×1.35+ — Devanagari matras */, fontWeight: '700', letterSpacing: 0.6,
    marginBottom: spacing.sm,
  },
  stepsCard: { borderRadius: radii.md, borderWidth: 1, padding: spacing.lg, gap: spacing.lg },
  nextStepRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  nextStepNum: {
    width: 32, height: 32, borderRadius: radii.pill, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  nextStepNumText: {
    fontSize: 13, lineHeight: 18, fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  nextStepText: { flex: 1, fontSize: 15, lineHeight: 22, fontWeight: '500' },
});

export default DiseaseReportForm;
