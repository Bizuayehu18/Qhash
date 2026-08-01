export type NotificationPresentationInput = Readonly<{
  message: string;
  metadata: unknown;
  title: string;
}>;

export function getNotificationType(
  notification: NotificationPresentationInput,
): string | undefined {
  const metadataType = (notification.metadata as Record<string, unknown> | null)
    ?.type;

  if (typeof metadataType === "string") {
    return metadataType;
  }

  const normalizedTitle = notification.title.trim().toLowerCase();

  if (normalizedTitle === "withdrawal approved") {
    return "withdrawal_approved";
  }

  if (normalizedTitle === "withdrawal rejected") {
    return "withdrawal_rejected";
  }

  return undefined;
}

export function getNotificationTitle(
  notification: NotificationPresentationInput,
  notificationType?: string,
): string {
  if (notificationType === "withdrawal_approved") {
    return "Withdrawal Approved";
  }

  if (notificationType === "withdrawal_rejected") {
    return "Withdrawal Rejected";
  }

  return notification.title;
}

export function getNotificationMessage(
  notification: NotificationPresentationInput,
  notificationType?: string,
): string {
  if (notificationType === "withdrawal_approved") {
    return notification.message.replace(
      "Your withdrawal request has been approved.",
      "Your withdrawal has been approved.",
    );
  }

  if (notificationType === "withdrawal_rejected") {
    return notification.message.replace(
      "Your withdrawal request was rejected and the full amount was returned to your wallet.",
      "Your withdrawal request was rejected. The full amount was returned to your wallet.",
    );
  }

  return notification.message;
}
