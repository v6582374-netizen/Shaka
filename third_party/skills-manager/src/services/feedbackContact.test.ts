import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isFeedbackContactType,
  validateFeedbackContact,
} from "./feedbackContact.ts";

test("validateFeedbackContact rejects empty contact type", () => {
  const result = validateFeedbackContact("", "alice@example.com");

  assert.deepEqual(result, {
    ok: false,
    errorKey: "feedback.form.contactTypeRequired",
  });
});

test("validateFeedbackContact rejects invalid email values", () => {
  const result = validateFeedbackContact("email", "abc");

  assert.deepEqual(result, {
    ok: false,
    errorKey: "feedback.form.contactValueInvalid",
  });
});

test("validateFeedbackContact rejects too-short wechat ids", () => {
  const result = validateFeedbackContact("wechat", "abc");

  assert.deepEqual(result, {
    ok: false,
    errorKey: "feedback.form.contactValueInvalid",
  });
});

test("validateFeedbackContact accepts wechat ids starting with underscore", () => {
  const result = validateFeedbackContact("wechat", "_wechat1");

  assert.deepEqual(result, {
    ok: true,
    contactType: "wechat",
    contactValue: "_wechat1",
  });
});

test("validateFeedbackContact rejects ambiguous other contact values", () => {
  const result = validateFeedbackContact("other", "abc");

  assert.deepEqual(result, {
    ok: false,
    errorKey: "feedback.form.contactValueInvalid",
  });
});

test("validateFeedbackContact accepts structured other contact values", () => {
  const result = validateFeedbackContact("other", "  QQ: 12345678  ");

  assert.deepEqual(result, {
    ok: true,
    contactType: "other",
    contactValue: "QQ: 12345678",
  });
});

test("isFeedbackContactType only accepts supported channel keys", () => {
  assert.equal(isFeedbackContactType("email"), true);
  assert.equal(isFeedbackContactType("wechat"), true);
  assert.equal(isFeedbackContactType("other"), true);
  assert.equal(isFeedbackContactType("github"), false);
  assert.equal(isFeedbackContactType("abc"), false);
});
