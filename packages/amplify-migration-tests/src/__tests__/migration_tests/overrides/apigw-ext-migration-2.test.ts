import {
  amplifyPushAuth,
  amplifyPushAuthLegacy,
  createNewProjectDir,
  deleteProject,
  deleteProjectDir,
  getCLIInputs,
  updateRestApi,
  addAuthWithDefault,
  updateAuthAddAdminQueries,
  updateAuthAdminQueriesWithExtMigration,
  getProjectMeta,
} from '@aws-amplify/amplify-e2e-core';
import { addRestApiOldDx } from '../../../migration-helpers/api';
import { initJSProjectWithProfileV4_52_0 } from '../../../migration-helpers';
import { v4 as uuid } from 'uuid';

describe('API Gateway CDK migration', () => {
  let projRoot: string;

  beforeEach(async () => {
    const [shortId] = uuid().split('-');
    const projName = `apigwmig${shortId}`;
    projRoot = await createNewProjectDir(projName);
    await initJSProjectWithProfileV4_52_0(projRoot, { name: projName });
  });

  afterEach(async () => {
    await deleteProject(projRoot, undefined, true);
    deleteProjectDir(projRoot);
  });

  it('migrates auth with admin queries', async () => {
    await addAuthWithDefault(projRoot);
    await updateAuthAddAdminQueries(projRoot);
    await amplifyPushAuthLegacy(projRoot);

    await updateAuthAdminQueriesWithExtMigration(projRoot, { testingWithLatestCodebase: true });
    await amplifyPushAuth(projRoot, true);

    const meta = getProjectMeta(projRoot);
    const authName = Object.keys(meta.auth)[0];

    const authCliInputs = getCLIInputs(projRoot, 'auth', authName);
    expect(authCliInputs).toBeDefined();

    const adminQueriesCliInputs = getCLIInputs(projRoot, 'api', 'AdminQueries');
    expect(adminQueriesCliInputs).toBeDefined();
  });
});
