export interface FolderMapping {
  id: string;
  title?: string;
  nickname?: string;
  role?: string;
  organisation?: string[];
}

export interface Plan {
  dataStorageId?: string;
  encodedId: string;
  project?: {
    title?: string;
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

export const transformPlansToFolders = (plans: Plan[]): { folders: FolderMapping[] } => {
  const folders = plans
    .filter((plan: Plan) => !!plan.dataStorageId)
    .filter(
      (plan: Plan) =>
        plan.projectMeta?.isLead === true ||
        plan.projectMeta?.isSupervisor === true ||
        plan.projectMeta?.editable === true,
    )
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
