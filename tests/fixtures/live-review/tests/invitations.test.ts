it('expires invitations after seven days', () => {
  const now = new Date('2026-01-01T00:00:00Z');
  expect(invitationExpiry(now).toISOString()).toBe('2026-01-08T00:00:00.000Z');
});
