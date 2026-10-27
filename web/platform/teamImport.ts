export type RoleImportDraft = Record<string, unknown> & {id: string};
export type RoleImportProgress = {confirmed: number; remaining: RoleImportDraft[]};
export type RoleImportOutcome = RoleImportProgress & {failed: boolean; error?: unknown};
export type RoleImportApi = {
  readRevision: () => Promise<number>;
  createRole: (role: RoleImportDraft, expectedRevision: number) => Promise<{revision?: number} | null | undefined>;
};

export class RoleImportInputError extends Error {
  readonly code = 'INVALID_ROLE_IMPORT';
  constructor() {super('INVALID_ROLE_IMPORT');}
}

export function prepareRoleImport(value: unknown, makeId: () => string): RoleImportDraft[] {
  if (!Array.isArray(value) || !value.length) throw new RoleImportInputError();
  const ids = new Set<string>();
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new RoleImportInputError();
    const draft = item as Record<string, unknown>, id = draft.id === undefined ? makeId() : draft.id;
    if (typeof id !== 'string' || !id.trim() || ids.has(id)) throw new RoleImportInputError();
    ids.add(id);
    return {...draft, id};
  });
}

/** Consume a confirmed role before observing any later role or team refresh. */
export async function importRoleProfiles(roles: RoleImportDraft[], api: RoleImportApi, onProgress: (value: RoleImportProgress) => void): Promise<RoleImportOutcome> {
  const remaining = [...roles];
  let confirmed = 0;
  try {
    let revision = await api.readRevision();
    while (remaining.length) {
      const receipt = await api.createRole(remaining[0], revision);
      remaining.shift();
      confirmed++;
      onProgress({confirmed, remaining: [...remaining]});
      const nextRevision = receipt?.revision;
      if (remaining.length) revision = typeof nextRevision === 'number' && Number.isSafeInteger(nextRevision) && nextRevision > 0 ? nextRevision : await api.readRevision();
    }
    return {confirmed, remaining, failed: false};
  } catch (error) {
    return {confirmed, remaining, failed: true, error};
  }
}
