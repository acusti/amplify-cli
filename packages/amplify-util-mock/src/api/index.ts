import { APITest } from './api';
import { addMockDataToGitIgnore, addMockAPIResourcesToGitIgnore } from '../utils';

export async function start(context) {
  const testApi = new APITest();
  try {
    addMockDataToGitIgnore(context);
    addMockAPIResourcesToGitIgnore(context);
    await testApi.start(context);
  } catch (e) {
    console.log(e);
    // Sending term signal so we clean up after ourselves
    process.kill(process.pid, 'SIGTERM');
  }
}
