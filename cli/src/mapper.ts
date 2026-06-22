export interface FolderMapping {
  id: string;
  title?: string;
  nickname?: string;
  role?: string;
  organisation?: string[];
}

export interface Collaborator {
  researcher: { id: string };
  role?: string;
  isReadOnly: boolean;
}

export interface Plan {
  dataStorageId?: string;
  encodedId: string;
  status?: string;
  project?: {
    title?: string;
    collaborators?: Collaborator[];
    organisation?: {
      faculty?: { name?: string };
      school?: { name?: string };
    };
  };
  projectMeta?: {
    isLead?: boolean;
    isSupervisor?: boolean;
    editable?: boolean;
    isCollaborator?: boolean;
  };
}

/** A per-plan record of whether the plan was mapped or skipped, and why. */
export interface PlanSummaryEntry {
  id: string;
  title?: string;
  mapped: boolean;
  reason: string;
}

interface PlanDecision {
  mapped: boolean;
  reason: string;
  /** Whether this decision should surface in the activity log (vs summary only). */
  logged: boolean;
}

const decidePlan = (plan: Plan, currentResearcherId?: string): PlanDecision => {
  if (plan.status === 'ARCHIVED') {
    return { mapped: false, reason: 'archived plan', logged: true };
  }
  if (!plan.dataStorageId) {
    // Plans without storage are expected and numerous; record them in the
    // summary but keep them out of the activity log to avoid noise.
    return { mapped: false, reason: 'no data storage', logged: false };
  }

  const meta = plan.projectMeta;
  // Check collaborator read-only status FIRST — editable can be true even for read-only collaborators.
  if (meta?.isCollaborator) {
    if (!currentResearcherId) {
      return { mapped: true, reason: 'collaborator — researcher ID unknown, deferring to SMB', logged: true };
    }
    const myEntry = plan.project?.collaborators?.find(
      (c) => c.researcher.id === currentResearcherId,
    );
    if (myEntry?.role?.toLowerCase() === 'read-only') {
      return { mapped: false, reason: 'read-only collaborator', logged: true };
    }
    if (!myEntry) {
      return { mapped: true, reason: 'collaborator — not found in collaborators list, deferring to SMB', logged: true };
    }
    return { mapped: true, reason: 'collaborator — editable', logged: true };
  }
  if (meta?.isLead) return { mapped: true, reason: 'lead', logged: false };
  if (meta?.isSupervisor) return { mapped: true, reason: 'supervisor', logged: false };
  if (meta?.editable) return { mapped: true, reason: 'editable', logged: false };
  return { mapped: false, reason: 'no matching role', logged: true };
};

const toFolderMapping = (plan: Plan): FolderMapping => {
  const folder: FolderMapping = {
    id: plan.encodedId,
    title: plan.project?.title,
  };

  if (plan.projectMeta) {
    if (plan.projectMeta.isLead) {
      folder.role = 'LEAD';
    } else if (plan.projectMeta.isSupervisor) {
      folder.role = 'SUPERVISOR';
    } else if (plan.projectMeta.isCollaborator) {
      folder.role = 'COLLABORATOR';
    }
  }

  if (plan.project?.organisation) {
    const orgs = [];
    if (plan.project.organisation.faculty?.name) {
      orgs.push(plan.project.organisation.faculty.name);
    }
    if (plan.project.organisation.school?.name) {
      orgs.push(plan.project.organisation.school.name);
    }
    if (orgs.length > 0) {
      folder.organisation = orgs;
    }
  }

  return folder;
};

export const transformPlansToFolders = (
  plans: Plan[],
  currentResearcherId?: string,
  onExcluded?: (title: string | undefined, reason: string, id: string) => void,
  onIncluded?: (title: string | undefined, reason: string, id: string) => void,
): { folders: FolderMapping[]; summary: PlanSummaryEntry[] } => {
  const evaluated = plans.map((plan) => ({ plan, decision: decidePlan(plan, currentResearcherId) }));

  evaluated.forEach(({ plan, decision }) => {
    if (!decision.logged) return;
    const notify = decision.mapped ? onIncluded : onExcluded;
    notify?.(plan.project?.title, decision.reason, plan.encodedId);
  });

  const folders = evaluated
    .filter(({ decision }) => decision.mapped)
    .map(({ plan }) => toFolderMapping(plan));

  const summary = evaluated.map(({ plan, decision }) => ({
    id: plan.encodedId,
    title: plan.project?.title,
    mapped: decision.mapped,
    reason: decision.reason,
  }));

  return { folders, summary };
};
