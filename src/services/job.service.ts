import fs from 'fs/promises';
import { config } from '../config';
import { securePath } from '../utils/helpers';
import type { StepOutput } from '../types';

export const getUserJobsDir = (userId: string): string =>
  securePath(config.PROFILES_DIR, userId, 'jobs');

export const getJobFilePath = (userId: string, jobId: string): string =>
  securePath(getUserJobsDir(userId), `${jobId}.json`);

export async function persistJob(
  userId: string,
  jobId: string,
  outputs: StepOutput[],
  result: Record<string, unknown>
): Promise<void> {
  const dir = getUserJobsDir(userId);
  await fs.mkdir(dir, { recursive: true });

  const data = {
    jobId,
    userId,
    state: result.success ? 'completed' : 'failed',
    progress: 100,
    finishedOn: new Date().toISOString(),
    stepOutputs: outputs,
    ...result
  };

  await fs.writeFile(
    getJobFilePath(userId, jobId),
    JSON.stringify(data, null, 2)
  );
}

export async function readJobFile(userId: string, jobId: string): Promise<unknown | null> {
  try {
    const content = await fs.readFile(getJobFilePath(userId, jobId), 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

export async function readPartialJobFile(userId: string, jobId: string): Promise<unknown | null> {
  try {
    const partialPath = getJobFilePath(userId, jobId).replace('.json', '_partial.json');
    const content = await fs.readFile(partialPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}