type TelemetryConsentValue = "unknown" | "granted" | "denied";

export function resolveTelemetryConsent(
  consent: TelemetryConsentValue | null | undefined,
): TelemetryConsentValue {
  if (consent === "granted" || consent === "denied") {
    return consent;
  }

  return "unknown";
}

export function shouldPromptForTelemetryConsent(
  consent: TelemetryConsentValue,
): boolean {
  return consent === "unknown";
}

export function isTelemetryCollectionEnabled(
  consent: TelemetryConsentValue,
): boolean {
  return consent === "granted";
}
