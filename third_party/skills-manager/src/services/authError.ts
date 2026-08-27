type AuthTranslationKey =
  | "auth.loginFailed"
  | "auth.googleLoginUnavailable"
  | "auth.githubLoginUnavailable";

type Translate = (key: AuthTranslationKey) => string;

type AuthErrorContext = {
  provider: "github" | "google";
  stage: "start" | "exchange";
};

function toMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error ?? "");
}

export function buildAuthErrorMessage(
  t: Translate,
  error: unknown,
  context: AuthErrorContext,
): string {
  const message = toMessage(error).trim();
  if (!message) {
    return t("auth.loginFailed");
  }

  if (message.includes("登录状态已过期")) {
    return message;
  }

  if (
    context.provider === "google" &&
    context.stage === "start" &&
    message.includes("Auth start failed: HTTP 500")
  ) {
    return t("auth.googleLoginUnavailable");
  }

  if (
    context.provider === "github" &&
    context.stage === "start" &&
    message.includes("Auth start failed: HTTP 500")
  ) {
    return t("auth.githubLoginUnavailable");
  }

  return `${t("auth.loginFailed")}：${message}`;
}
