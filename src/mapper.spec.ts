import { transformPlansToFolders } from './mapper';

describe('transformPlansToFolders', () => {
  it('should transform plans.json format into folders.json format', () => {
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
          title: 'Should be ignored due to projectMeta conditions',
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
        project: { title: 'Should be ignored' },
      },
    ];

    const result = transformPlansToFolders(input);
    expect(result.folders).toHaveLength(1);
    expect(result.folders[0]).toEqual({
      id: 'MOZGYH8890',
      title: 'Launch Job ids',
      role: 'LEAD',
      organisation: ['Faculty of Business & Law', 'School of Law'],
    });
  });
});
