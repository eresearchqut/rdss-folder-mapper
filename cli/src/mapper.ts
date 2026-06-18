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

export const transformPlansToFolders = (
  plans: Plan[],
  currentResearcherId?: string,
  onExcluded?: (title: string | undefined, reason: string) => void,
  onIncluded?: (title: string | undefined, reason: string) => void,
): { folders: FolderMapping[] } => {
  const folders = plans
    .filter((plan: Plan) => {
      if (plan.status === 'ARCHIVED') {
        onExcluded?.(plan.project?.title, 'archived plan');
        return false;
      }
      return true;
    })
    .filter((plan: Plan) => !!plan.dataStorageId)
    .filter((plan: Plan) => {
      const meta = plan.projectMeta;
      // Check collaborator read-only status FIRST — editable can be true even for read-only collaborators.
      if (meta?.isCollaborator) {
        if (!currentResearcherId) {
          onIncluded?.(plan.project?.title, 'collaborator — researcher ID unknown, deferring to SMB');
          return true;
        }
        const myEntry = plan.project?.collaborators?.find(
          (c) => c.researcher.id === currentResearcherId,
        );
        if (myEntry?.role?.toLowerCase() === 'read-only') {
          onExcluded?.(plan.project?.title, 'read-only collaborator');
          return false;
        }
        if (!myEntry) {
          onIncluded?.(plan.project?.title, 'collaborator — not found in collaborators list, deferring to SMB');
        } else {
          onIncluded?.(plan.project?.title, 'collaborator — editable');
        }
        return true;
      }
      if (meta?.isLead || meta?.isSupervisor || meta?.editable) return true;
      onExcluded?.(plan.project?.title, 'no matching role');
      return false;
    })
    .map((plan: Plan) => {
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
    });

  return { folders };
};
