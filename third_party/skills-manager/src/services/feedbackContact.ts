import type { TranslationPath } from "../i18n";
import type { FeedbackContactType } from "../types";

export const FEEDBACK_CONTACT_TYPES = [
  "wechat",
  "email",
  "other",
] as const satisfies readonly FeedbackContactType[];

export const FEEDBACK_CONTACT_TYPE_LABEL_KEY_MAP = {
  wechat: "feedback.form.contactOptionWechat",
  email: "feedback.form.contactOptionEmail",
  other: "feedback.form.contactOptionOther",
} as const satisfies Record<FeedbackContactType, TranslationPath>;

const FEEDBACK_CONTACT_VALUE_PLACEHOLDER_KEY_MAP = {
  wechat: "feedback.form.contactValuePlaceholderWechat",
  email: "feedback.form.contactValuePlaceholderEmail",
  other: "feedback.form.contactValuePlaceholderOther",
} as const satisfies Record<FeedbackContactType, TranslationPath>;

type FeedbackContactValidationErrorKey =
  | "feedback.form.contactTypeRequired"
  | "feedback.form.contactTypeInvalid"
  | "feedback.form.contactValueRequired"
  | "feedback.form.contactValueInvalid";

type FeedbackContactValidationResult =
  | {
      ok: true;
      contactType: FeedbackContactType;
      contactValue: string;
    }
  | {
      ok: false;
      errorKey: FeedbackContactValidationErrorKey;
    };

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WECHAT_REGEX = /^[a-zA-Z][-_a-zA-Z0-9]{5,19}$/;
const OTHER_CONTACT_REGEX = /^[^:：\s][^:：]{0,19}\s*[:：]\s*\S.{1,}$/;

export function isFeedbackContactType(
  value: string,
): value is FeedbackContactType {
  return FEEDBACK_CONTACT_TYPES.includes(value as FeedbackContactType);
}

export function getFeedbackContactValuePlaceholderKey(
  contactType: FeedbackContactType | "",
): TranslationPath {
  if (!contactType) {
    return "feedback.form.contactValuePlaceholder";
  }

  return FEEDBACK_CONTACT_VALUE_PLACEHOLDER_KEY_MAP[contactType];
}

export function validateFeedbackContact(
  contactTypeInput: string,
  contactValueInput: string,
): FeedbackContactValidationResult {
  const contactType = contactTypeInput.trim();
  if (!contactType) {
    return { ok: false, errorKey: "feedback.form.contactTypeRequired" };
  }

  if (!isFeedbackContactType(contactType)) {
    return { ok: false, errorKey: "feedback.form.contactTypeInvalid" };
  }

  const contactValue = contactValueInput.trim();
  if (!contactValue) {
    return { ok: false, errorKey: "feedback.form.contactValueRequired" };
  }

  if (!isValidFeedbackContactValue(contactType, contactValue)) {
    return { ok: false, errorKey: "feedback.form.contactValueInvalid" };
  }

  return {
    ok: true,
    contactType,
    contactValue,
  };
}

function isValidFeedbackContactValue(
  contactType: FeedbackContactType,
  contactValue: string,
): boolean {
  switch (contactType) {
    case "wechat":
      return WECHAT_REGEX.test(contactValue);
    case "email":
      return EMAIL_REGEX.test(contactValue);
    case "other":
      return OTHER_CONTACT_REGEX.test(contactValue);
    default:
      return false;
  }
}
