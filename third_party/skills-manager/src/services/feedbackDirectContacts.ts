export const FEEDBACK_GROUP_CONTACT_CHANNELS = [
  {
    id: "wechatGroup",
    labelKey: "feedback.contact.wechatGroupLabel",
    descriptionKey: "feedback.contact.wechatGroupDesc",
  },
  {
    id: "feishuGroup",
    labelKey: "feedback.contact.feishuGroupLabel",
    descriptionKey: "feedback.contact.feishuGroupDesc",
  },
] as const;

export type FeedbackGroupContactChannelId =
  (typeof FEEDBACK_GROUP_CONTACT_CHANNELS)[number]["id"];
