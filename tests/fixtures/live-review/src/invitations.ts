export const invitationExpiry = (now: Date) =>
  new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
