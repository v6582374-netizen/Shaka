import { FormEvent, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "@/i18n";
import feishuGroupQrCode from "@/assets/group/feishuqun.png";
import wechatGroupQrCode from "@/assets/group/weixinqun.png";
import { submitFeedback } from "@/services/feedback";
import {
  FEEDBACK_CONTACT_TYPES,
  FEEDBACK_CONTACT_TYPE_LABEL_KEY_MAP,
  getFeedbackContactValuePlaceholderKey,
  validateFeedbackContact,
} from "@/services/feedbackContact";
import {
  FEEDBACK_GROUP_CONTACT_CHANNELS,
  type FeedbackGroupContactChannelId,
} from "@/services/feedbackDirectContacts";
import { PageHeader } from "@/components/ui/page-header";
import { ToastContainer, useToast } from "@/components/ui/toast";
import type { FeedbackContactType } from "@/types";

const GITHUB_ISSUES_URL =
  "https://github.com/jiweiyeah/Skills-Manager/issues/new/choose";
const CONTACT_EMAIL = "freeourdays@gmail.com";
const WECHAT_NOTE = "skills-manager";
const GROUP_CONTACT_QR_CODE_MAP: Record<FeedbackGroupContactChannelId, string> = {
  wechatGroup: wechatGroupQrCode,
  feishuGroup: feishuGroupQrCode,
};

export function Feedback() {
  const { t, language } = useTranslation();
  const { toasts, addToast, removeToast } = useToast();
  const [contactType, setContactType] = useState<FeedbackContactType | "">("");
  const [contactValue, setContactValue] = useState("");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [contactTypeDropdownOpen, setContactTypeDropdownOpen] = useState(false);

  const handleOpenGithubIssues = async () => {
    try {
      await openUrl(GITHUB_ISSUES_URL);
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : t("feedback.issueOpenFailed"),
        "error",
      );
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedContent = content.trim();
    const contactValidation = validateFeedbackContact(contactType, contactValue);
    if (!contactValidation.ok) {
      addToast(t(contactValidation.errorKey), "error");
      return;
    }

    if (!trimmedContent) {
      addToast(t("feedback.form.contentRequired"), "error");
      return;
    }

    setSubmitting(true);
    try {
      await submitFeedback({
        contact_type: contactValidation.contactType,
        contact_value: contactValidation.contactValue,
        content: trimmedContent,
        source: "desktop-feedback-page",
        language,
      });
      setContactType("");
      setContactValue("");
      setContent("");
      addToast(t("feedback.form.submitSuccess"), "success");
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : t("feedback.form.submitFailed"),
        "error",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        backgroundColor: "var(--background)",
      }}
    >
      <PageHeader title={t("feedback.title")} />
      <main
        className="page-main"
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "auto",
        }}
      >
        <div className="page-container" style={{ maxWidth: "760px" }}>
          <p
            style={{
              margin: "0 0 20px 0",
              fontSize: "14px",
              lineHeight: 1.7,
              color: "var(--muted-foreground)",
            }}
          >
            {t("feedback.description")}
          </p>

          <SectionTitle>{t("feedback.issueTitle")}</SectionTitle>
          <FeedbackCard>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "16px",
                padding: "16px 0",
                borderBottom: "1px solid var(--border)",
              }}
            >
              <div style={{ flex: 1, marginRight: "16px" }}>
                <div
                  style={{
                    fontSize: "14px",
                    fontWeight: 500,
                    color: "var(--foreground)",
                    marginBottom: "2px",
                  }}
                >
                  {t("feedback.issueGithubTitle")}
                </div>
                <div
                  style={{
                    fontSize: "13px",
                    lineHeight: 1.6,
                    color: "var(--muted-foreground)",
                  }}
                >
                  {t("feedback.issueGithubDesc")}
                </div>
              </div>
              <button
                onClick={handleOpenGithubIssues}
                style={{
                  padding: "8px 14px",
                  fontSize: "13px",
                  fontWeight: 500,
                  color: "var(--primary-foreground)",
                  backgroundColor: "var(--primary)",
                  border: "none",
                  borderRadius: "8px",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  transition: "opacity 0.15s",
                  flexShrink: 0,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.opacity = "0.9";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.opacity = "1";
                }}
              >
                {t("feedback.issueGithubAction")}
              </button>
            </div>

            <form onSubmit={handleSubmit} style={{ padding: "18px 0 22px 0" }}>
              <div
                style={{
                  fontSize: "14px",
                  fontWeight: 500,
                  color: "var(--foreground)",
                  marginBottom: "2px",
                }}
              >
                {t("feedback.issueDirectTitle")}
              </div>
              <div
                style={{
                  fontSize: "13px",
                  lineHeight: 1.6,
                  color: "var(--muted-foreground)",
                  marginBottom: "16px",
                }}
              >
                {t("feedback.issueDirectDesc")}
              </div>

              <div
                style={{
                  display: "flex",
                  gap: "12px",
                  flexWrap: "wrap",
                  marginBottom: "8px",
                }}
              >
                <div style={{ flex: "0 0 180px", minWidth: "180px" }}>
                  <FormLabel
                    htmlFor="feedback-contact-type"
                    label={t("feedback.form.contactTypeLabel")}
                    required
                  />
                  <div style={{ position: "relative" }}>
                    <button
                      id="feedback-contact-type"
                      type="button"
                      onClick={() => setContactTypeDropdownOpen((v) => !v)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "8px",
                        width: "100%",
                        padding: "8px 12px",
                        fontSize: "13px",
                        fontWeight: 500,
                        textAlign: "left",
                        color: contactType ? "var(--foreground)" : "var(--muted-foreground)",
                        backgroundColor: contactTypeDropdownOpen ? "var(--secondary)" : "var(--background)",
                        border: "1px solid var(--border)",
                        borderRadius: "8px",
                        cursor: "pointer",
                        transition: "all 0.15s",
                      }}
                      onMouseEnter={(e) => {
                        if (!contactTypeDropdownOpen) {
                          e.currentTarget.style.backgroundColor = "var(--muted)";
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!contactTypeDropdownOpen) {
                          e.currentTarget.style.backgroundColor = "var(--background)";
                        }
                      }}
                    >
                      <span>
                        {contactType
                          ? t(FEEDBACK_CONTACT_TYPE_LABEL_KEY_MAP[contactType])
                          : t("feedback.form.contactTypePlaceholder")}
                      </span>
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        style={{
                          transition: "transform 0.2s ease",
                          transform: contactTypeDropdownOpen ? "rotate(180deg)" : "rotate(0deg)",
                          flexShrink: 0,
                        }}
                      >
                        <path d="M6 9l6 6 6-6"/>
                      </svg>
                    </button>

                    {contactTypeDropdownOpen && (
                      <>
                        <div
                          style={{
                            position: "fixed",
                            inset: 0,
                            zIndex: 10,
                          }}
                          onClick={() => setContactTypeDropdownOpen(false)}
                        />
                        <div className="animate-popover" style={{
                          position: "absolute",
                          top: "calc(100% + 6px)",
                          left: 0,
                          right: 0,
                          backgroundColor: "var(--popover)",
                          border: "1px solid var(--glass-border-strong)",
                          borderRadius: "10px",
                          zIndex: 20,
                          padding: "5px",
                          overflow: "hidden",
                          boxShadow: "var(--shadow-xl)",
                        }}>
                          {FEEDBACK_CONTACT_TYPES.map((type) => {
                            const isSelected = contactType === type;
                            return (
                              <button
                                key={type}
                                type="button"
                                onClick={() => {
                                  setContactType(type);
                                  setContactValue("");
                                  setContactTypeDropdownOpen(false);
                                }}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "8px",
                                  width: "100%",
                                  padding: "7px 10px",
                                  fontSize: "13px",
                                  color: isSelected ? "var(--foreground)" : "var(--popover-foreground)",
                                  backgroundColor: isSelected ? "var(--secondary)" : "transparent",
                                  border: "none",
                                  borderRadius: "6px",
                                  cursor: "pointer",
                                  textAlign: "left",
                                  transition: "all 0.12s",
                                }}
                                onMouseEnter={(e) => {
                                  if (!isSelected) {
                                    e.currentTarget.style.backgroundColor = "var(--accent)";
                                  }
                                }}
                                onMouseLeave={(e) => {
                                  if (!isSelected) {
                                    e.currentTarget.style.backgroundColor = "transparent";
                                  }
                                }}
                              >
                                <span>{t(FEEDBACK_CONTACT_TYPE_LABEL_KEY_MAP[type])}</span>
                                {isSelected && (
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginLeft: "auto" }}>
                                    <path d="M20 6L9 17l-5-5"/>
                                  </svg>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <div style={{ flex: "1 1 280px", minWidth: "240px" }}>
                  <FormLabel
                    htmlFor="feedback-contact-value"
                    label={t("feedback.form.contactValueLabel")}
                    required
                  />
                  <input
                    id="feedback-contact-value"
                    type={contactType === "email" ? "email" : "text"}
                    inputMode={contactType === "email" ? "email" : "text"}
                    disabled={!contactType}
                    value={contactValue}
                    onChange={(e) => setContactValue(e.target.value)}
                    placeholder={t(
                      getFeedbackContactValuePlaceholderKey(contactType),
                    )}
                    style={{
                      ...formControlStyle,
                      cursor: contactType ? "text" : "not-allowed",
                      opacity: contactType ? 1 : 0.6,
                    }}
                  />
                </div>
              </div>

              <div
                style={{
                  fontSize: "12px",
                  lineHeight: 1.6,
                  color: "var(--muted-foreground)",
                  marginBottom: "16px",
                }}
              >
                {t("feedback.form.contactHelp")}
              </div>

              <FormLabel
                htmlFor="feedback-content"
                label={t("feedback.form.contentLabel")}
                required
              />
              <textarea
                id="feedback-content"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={t("feedback.form.contentPlaceholder")}
                rows={6}
                style={{
                  ...formControlStyle,
                  lineHeight: 1.6,
                  resize: "vertical",
                  minHeight: "132px",
                }}
              />

              <div
                style={{
                  display: "flex",
                  justifyContent: "flex-end",
                  marginTop: "14px",
                }}
              >
                <button
                  type="submit"
                  disabled={submitting}
                  style={{
                    padding: "8px 16px",
                    fontSize: "13px",
                    fontWeight: 500,
                    color: "var(--primary-foreground)",
                    backgroundColor: "var(--foreground)",
                    border: "none",
                    borderRadius: "8px",
                    cursor: submitting ? "wait" : "pointer",
                    opacity: submitting ? 0.7 : 1,
                    transition: "opacity 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    if (!submitting) {
                      e.currentTarget.style.opacity = "0.85";
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.opacity = submitting ? "0.7" : "1";
                  }}
                >
                  {submitting
                    ? t("feedback.form.submitting")
                    : t("feedback.form.submit")}
                </button>
              </div>
            </form>
          </FeedbackCard>

          <SectionTitle>{t("feedback.contactTitle")}</SectionTitle>
          <FeedbackCard>
            <div style={{ padding: "16px 0" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "12px",
                  padding: "8px 0",
                }}
              >
                <span
                  style={{
                    color: "var(--muted-foreground)",
                    minWidth: "56px",
                    fontSize: "13px",
                  }}
                >
                  {t("feedback.contact.wechatLabel")}
                </span>
                <span style={{ color: "var(--foreground)", lineHeight: 1.6, fontSize: "13px" }}>
                  {t("feedback.contact.wechatDesc").replace(
                    "{note}",
                    WECHAT_NOTE,
                  )}
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "8px 0",
                }}
              >
                <span
                  style={{
                    color: "var(--muted-foreground)",
                    minWidth: "56px",
                    fontSize: "13px",
                  }}
                >
                  {t("feedback.contact.emailLabel")}
                </span>
                <a
                  href={`mailto:${CONTACT_EMAIL}`}
                  style={{
                    color: "var(--primary)",
                    textDecoration: "none",
                    fontWeight: 500,
                    fontSize: "13px",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.textDecoration = "underline";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.textDecoration = "none";
                  }}
                >
                  {CONTACT_EMAIL}
                </a>
              </div>
              <div
                style={{
                  marginTop: "14px",
                  paddingTop: "14px",
                  borderTop: "1px solid var(--border)",
                }}
              >
                <div
                  style={{
                    fontSize: "12px",
                    lineHeight: 1.6,
                    color: "var(--muted-foreground)",
                    marginBottom: "12px",
                  }}
                >
                  {t("feedback.contact.groupHint")}
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                    gap: "12px",
                  }}
                >
                  {FEEDBACK_GROUP_CONTACT_CHANNELS.map((channel) => (
                    <ContactQrCard
                      key={channel.id}
                      title={t(channel.labelKey)}
                      description={t(channel.descriptionKey)}
                      imageSrc={GROUP_CONTACT_QR_CODE_MAP[channel.id]}
                    />
                  ))}
                </div>
              </div>
            </div>
          </FeedbackCard>
        </div>
      </main>
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        fontSize: "15px",
        fontWeight: 600,
        color: "var(--foreground)",
        margin: "0 0 12px 0",
        scrollMarginTop: "24px",
      }}
    >
      {children}
    </h2>
  );
}

const formControlStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  fontSize: "13px",
  border: "1px solid var(--border)",
  borderRadius: "8px",
  backgroundColor: "var(--background)",
  color: "var(--foreground)",
  transition: "border-color 0.15s, box-shadow 0.15s",
  appearance: "none",
  WebkitAppearance: "none",
  MozAppearance: "none",
};

function FormLabel({
  htmlFor,
  label,
  required,
}: {
  htmlFor: string;
  label: string;
  required?: boolean;
}) {
  return (
    <label
      htmlFor={htmlFor}
      style={{
        display: "block",
        fontSize: "12px",
        fontWeight: 500,
        color: "var(--foreground)",
        marginBottom: "6px",
      }}
    >
      {label}
      {required && (
        <span style={{ color: "var(--color-error)", marginLeft: "4px" }}>*</span>
      )}
    </label>
  );
}

function FeedbackCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        backgroundColor: "var(--secondary)",
        borderRadius: "12px",
        border: "1px solid var(--border)",
        padding: "0 20px",
        marginBottom: "32px",
      }}
    >
      {children}
    </div>
  );
}

interface ContactQrCardProps {
  title: string;
  description: string;
  imageSrc: string;
}

function ContactQrCard({
  title,
  description,
  imageSrc,
}: ContactQrCardProps) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "10px",
        padding: "16px",
        borderRadius: "10px",
        border: "1px solid var(--border)",
        backgroundColor: "var(--background)",
      }}
    >
      <img
        src={imageSrc}
        alt={title}
        style={{
          width: "100%",
          maxWidth: "140px",
          aspectRatio: "1 / 1",
          borderRadius: "6px",
          border: "1px solid var(--border)",
          backgroundColor: "var(--primary-foreground)",
          objectFit: "contain",
        }}
      />
      <div
        style={{
          fontSize: "12px",
          fontWeight: 500,
          color: "var(--foreground)",
        }}
      >
        {title}
      </div>
      <div
        style={{
          fontSize: "12px",
          lineHeight: 1.5,
          textAlign: "center",
          color: "var(--muted-foreground)",
        }}
      >
        {description}
      </div>
    </div>
  );
}
