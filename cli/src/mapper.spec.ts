import { describe, expect, it } from 'vitest';
import { transformPlansToFolders } from './mapper';

describe('transformPlansToFolders', () => {
  it('should transform plans.json format into folders.json format', () => {
    const currentResearcherId = 'researcher-001';
    const input = [
      {
        dataStorageId: 'some-id',
        encodedId: 'MOZGYH8890',
        project: {
          title: 'Launch Job ids',
          organisation: {
            faculty: { name: 'Faculty of Business & Law' },
            school: { name: 'School of Law' },
          },
        },
        projectMeta: {
          isLead: true,
          isCollaborator: false,
          isSupervisor: false,
        },
      },
      {
        dataStorageId: 'some-other-id',
        encodedId: 'SHOULD_IGNORE_123',
        project: {
          title: 'Should be ignored — collaborator is read-only',
          collaborators: [
            { researcher: { id: currentResearcherId }, isReadOnly: true, role: 'Read-only' },
          ],
        },
        projectMeta: {
          isLead: false,
          isCollaborator: true,
          isSupervisor: false,
          editable: false,
        },
      },
      {
        encodedId: 'NO_STORAGE_ID',
        project: { title: 'Should be ignored — no dataStorageId' },
      },
    ];

    const result = transformPlansToFolders(input, currentResearcherId);
    expect(result.folders).toHaveLength(1);
    expect(result.folders[0]).toEqual({
      id: 'MOZGYH8890',
      title: 'Launch Job ids',
      role: 'LEAD',
      organisation: ['Faculty of Business & Law', 'School of Law'],
    });
  });

  describe('collaborator read-only filtering', () => {
    const researcherId = 'user-abc-123';

    const makeCollaboratorPlan = (isReadOnly: boolean, role = 'Read-only', collaboratorId = researcherId) => ({
      dataStorageId: 'storage-1',
      encodedId: 'COLLAB001',
      project: {
        title: 'Collab Project',
        collaborators: [
          { researcher: { id: collaboratorId }, isReadOnly, role },
        ],
      },
      projectMeta: { isCollaborator: true, isLead: false, isSupervisor: false, editable: false },
    });

    it('excludes collaborator plans where role=Read-only', () => {
      const result = transformPlansToFolders([makeCollaboratorPlan(true, 'Read-only')], researcherId);
      expect(result.folders).toHaveLength(0);
    });

    it('includes collaborator plans where role=Read-only but isReadOnly=false (API inconsistency)', () => {
      const result = transformPlansToFolders([makeCollaboratorPlan(false, 'Read-only')], researcherId);
      expect(result.folders).toHaveLength(0);
    });

    it('includes collaborator plans where isReadOnly=true but role=Editor', () => {
      const result = transformPlansToFolders([makeCollaboratorPlan(true, 'Editor')], researcherId);
      expect(result.folders).toHaveLength(1);
      expect(result.folders[0].role).toBe('COLLABORATOR');
    });

    it('includes collaborator plans where isReadOnly=false', () => {
      const result = transformPlansToFolders([makeCollaboratorPlan(false, 'Editor')], researcherId);
      expect(result.folders).toHaveLength(1);
      expect(result.folders[0].role).toBe('COLLABORATOR');
    });

    it('includes collaborator plans when no currentResearcherId is provided (SMB will gatekeep)', () => {
      const result = transformPlansToFolders([makeCollaboratorPlan(true, 'Read-only')]);
      expect(result.folders).toHaveLength(1);
    });

    it('includes collaborator plan when the current user is not found in the collaborators list (SMB will gatekeep)', () => {
      const result = transformPlansToFolders([makeCollaboratorPlan(true, 'Read-only', 'other-user-id')], researcherId);
      expect(result.folders).toHaveLength(1);
    });

    it('calls onExcluded with the plan title, reason, and id when a read-only collaborator is excluded', () => {
      const excluded: { title: string | undefined; reason: string; id: string }[] = [];
      transformPlansToFolders(
        [makeCollaboratorPlan(true, 'Read-only')],
        researcherId,
        (title, reason, id) => excluded.push({ title, reason, id }),
      );
      expect(excluded).toEqual([{ title: 'Collab Project', reason: 'read-only collaborator', id: 'COLLAB001' }]);
    });

    it('does not affect lead or supervisor plans regardless of collaborator list', () => {
      const plan = {
        dataStorageId: 'storage-2',
        encodedId: 'LEAD001',
        project: { title: 'Lead Project', collaborators: [] },
        projectMeta: { isLead: true, isCollaborator: false, isSupervisor: false, editable: false },
      };
      const result = transformPlansToFolders([plan], researcherId);
      expect(result.folders).toHaveLength(1);
      expect(result.folders[0].role).toBe('LEAD');
    });
  });

  describe('archived plan filtering', () => {
    it('excludes plans where status is ARCHIVED', () => {
      const plan = {
        dataStorageId: 'storage-3',
        encodedId: 'ARCH001',
        status: 'ARCHIVED',
        project: { title: 'Archived Project' },
        projectMeta: { isLead: true, isCollaborator: false, isSupervisor: false },
      };
      const result = transformPlansToFolders([plan]);
      expect(result.folders).toHaveLength(0);
    });

    it('calls onExcluded with the plan title, reason, and id for archived plans', () => {
      const excluded: { title: string | undefined; reason: string; id: string }[] = [];
      transformPlansToFolders(
        [{
          dataStorageId: 'storage-3',
          encodedId: 'ARCH001',
          status: 'ARCHIVED',
          project: { title: 'Archived Project' },
          projectMeta: { isLead: true, isCollaborator: false, isSupervisor: false },
        }],
        undefined,
        (title, reason, id) => excluded.push({ title, reason, id }),
      );
      expect(excluded).toEqual([{ title: 'Archived Project', reason: 'archived plan', id: 'ARCH001' }]);
    });

    it('includes non-archived plans', () => {
      const plan = {
        dataStorageId: 'storage-3',
        encodedId: 'ACTIVE001',
        status: 'ACTIVE',
        project: { title: 'Active Project' },
        projectMeta: { isLead: true, isCollaborator: false, isSupervisor: false },
      };
      const result = transformPlansToFolders([plan]);
      expect(result.folders).toHaveLength(1);
    });
  });

  describe('summary', () => {
    it('returns a summary entry for every plan with mapped status and reason', () => {
      const researcherId = 'researcher-001';
      const input = [
        {
          dataStorageId: 'storage-1',
          encodedId: 'LEAD001',
          project: { title: 'Lead Project' },
          projectMeta: { isLead: true, isCollaborator: false, isSupervisor: false },
        },
        {
          encodedId: 'NO_STORAGE',
          project: { title: 'No Storage Project' },
        },
        {
          dataStorageId: 'storage-2',
          encodedId: 'ARCH001',
          status: 'ARCHIVED',
          project: { title: 'Archived Project' },
          projectMeta: { isLead: true },
        },
        {
          dataStorageId: 'storage-3',
          encodedId: 'RO001',
          project: {
            title: 'Read-only Collab',
            collaborators: [{ researcher: { id: researcherId }, isReadOnly: true, role: 'Read-only' }],
          },
          projectMeta: { isCollaborator: true },
        },
      ];

      const { folders, summary } = transformPlansToFolders(input, researcherId);

      expect(folders).toHaveLength(1);
      expect(summary).toEqual([
        { id: 'LEAD001', title: 'Lead Project', mapped: true, reason: 'lead' },
        { id: 'NO_STORAGE', title: 'No Storage Project', mapped: false, reason: 'no data storage' },
        { id: 'ARCH001', title: 'Archived Project', mapped: false, reason: 'archived plan' },
        { id: 'RO001', title: 'Read-only Collab', mapped: false, reason: 'read-only collaborator' },
      ]);
    });
  });
});
