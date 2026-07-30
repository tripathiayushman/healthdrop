// =====================================================
// ERROR BOUNDARY — last-resort crash recovery screen
// Catches render errors below it and shows a plain-language
// recovery card instead of a silent white screen. Styled
// entirely through ThemeContext tokens, so it must be
// mounted inside ThemeProvider (App.tsx wraps AppContent).
// =====================================================
import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../lib/ThemeContext';

interface FallbackProps {
  onReset: () => void;
}

/** Small themed wrapper so the class boundary can read theme tokens via hooks. */
function ErrorFallback({ onReset }: FallbackProps) {
  const { colors, spacing, radii } = useTheme();

  return (
    <View style={[styles.container, { backgroundColor: colors.background, padding: spacing.lg }]}>
      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderRadius: radii.md,
            padding: spacing.lg,
          },
        ]}
      >
        <Text style={[styles.title, { color: colors.text }]} maxFontSizeMultiplier={1.3}>
          Something went wrong
        </Text>
        <Text style={[styles.body, { color: colors.textSecondary, marginTop: spacing.sm }]}>
          The app hit an unexpected problem. Your saved reports are still safe on this phone.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Try again"
          onPress={onReset}
          style={({ pressed }) => [
            styles.button,
            {
              backgroundColor: pressed ? colors.primaryDark : colors.primary,
              borderRadius: radii.md,
              marginTop: spacing.xl,
            },
          ]}
        >
          <Text style={[styles.buttonLabel, { color: colors.onPrimary }]}>Try again</Text>
        </Pressable>
      </View>
    </View>
  );
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export default class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error(
      '[ErrorBoundary] Render error caught:',
      error,
      errorInfo?.componentStack ?? ''
    );
  }

  private handleReset = (): void => {
    this.setState({ hasError: false });
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      return <ErrorFallback onReset={this.handleReset} />;
    }
    return this.props.children;
  }
}

// ─── Global JS error hooks ───────────────────────────────
// The boundary only catches React render errors. These hooks
// catch everything else (event handlers, async work) so fatal
// errors at least leave a trace instead of a silent white
// screen. Installed once from App.tsx at module load.

type RNGlobalErrorHandler = (error: unknown, isFatal?: boolean) => void;

interface RNErrorUtils {
  getGlobalHandler?: () => RNGlobalErrorHandler | undefined;
  setGlobalHandler?: (handler: RNGlobalErrorHandler) => void;
}

let globalHooksInstalled = false;

export function installGlobalErrorHooks(): void {
  if (globalHooksInstalled) return;
  globalHooksInstalled = true;

  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('error', (event: ErrorEvent) => {
        console.error('[GlobalError]', event?.error ?? event?.message ?? event);
      });
      window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
        console.error('[GlobalError] Unhandled promise rejection:', event?.reason ?? event);
      });
    }
    return;
  }

  // Native (Hermes): ErrorUtils is an RN global — guard in case it is absent
  // (equivalent to `typeof ErrorUtils !== 'undefined'`, but safe under TS
  // because RN only exports ErrorUtils as a type, not a declared global).
  const errorUtils = (globalThis as { ErrorUtils?: RNErrorUtils }).ErrorUtils;
  if (errorUtils && typeof errorUtils.setGlobalHandler === 'function') {
    const previousHandler =
      typeof errorUtils.getGlobalHandler === 'function'
        ? errorUtils.getGlobalHandler()
        : undefined;
    errorUtils.setGlobalHandler((error: unknown, isFatal?: boolean) => {
      console.error('[GlobalError]', isFatal ? '(fatal)' : '(non-fatal)', error);
      // Preserve RN's own handling (dev redbox, native crash reporting).
      if (typeof previousHandler === 'function') {
        previousHandler(error, isFatal);
      }
    });
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderWidth: 1,
  },
  title: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '800',
    letterSpacing: -0.4,
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
  },
  button: {
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
  },
  buttonLabel: {
    fontSize: 16,
    fontWeight: '700',
  },
});
