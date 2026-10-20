export async function inviteMember(db, actor, email) {
  if (!actor.roles.includes('admin')) throw new Error('Forbidden');
  const existing = await db.invitations.findFirst({ email });
  if (existing) return existing;
  return db.invitations.create({ email, tenant_id: actor.tenant_id });
}
