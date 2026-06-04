import type IORedis from 'ioredis';
import { randomBytes } from 'crypto';

import { config } from '../config';
import type { Workflow, WorkflowVersionSnapshot } from '../types';
import {
  getWorkflowKey,
  getUserWorkflowsKey,
  getWorkflowVersionKey,
  getWorkflowVersionIndexKey,
} from '../utils/redis-keys';

// ============================================================
// Workflow Storage service (Step 17, category G2)
//
// A single source of truth for saving/loading reusable, versioned workflows in
// Redis. CRUD endpoints, the re-run endpoint, the n8n node and the UI all go
// through here so every client sees the same records and the same version
// history. Everything is scoped per-user; ids are server-generated.
// ============================================================

// Fields a client may supply when creating/updating a workflow. id/userId/
// version/timestamps are always assigned by the server.
export interface WorkflowInput {
  name: string;
  description?: string | null;
  steps: unknown[];
  headless?: boolean | string | number | null;
  webhookUrl?: string | null;
}

// Generate a short, URL-safe, collision-resistant workflow id (16 hex chars).
const generateWorkflowId = (): string => `wf_${randomBytes(8).toString('hex')}`;

const nowIso = (): string => new Date().toISOString();

export class WorkflowService {
  private redis: IORedis;

  constructor(redis: IORedis) {
    this.redis = redis;
  }

  // Build a version snapshot from a stored workflow record.
  private static toSnapshot(wf: Workflow): WorkflowVersionSnapshot {
    return {
      version: wf.version,
      name: wf.name,
      description: wf.description,
      steps: wf.steps,
      headless: wf.headless,
      webhookUrl: wf.webhookUrl,
      savedAt: wf.updatedAt,
    };
  }

  // Persist a version snapshot + trim history to WORKFLOW_MAX_VERSIONS, dropping
  // the oldest entries so the history never grows unbounded.
  private async saveVersion(wf: Workflow): Promise<void> {
    const snap = WorkflowService.toSnapshot(wf);
    await this.redis.set(
      getWorkflowVersionKey(wf.userId, wf.id, wf.version),
      JSON.stringify(snap)
    );
    const idxKey = getWorkflowVersionIndexKey(wf.userId, wf.id);
    await this.redis.sadd(idxKey, String(wf.version));

    const max = config.WORKFLOW_MAX_VERSIONS;
    if (max > 0) {
      const versions = (await this.redis.smembers(idxKey))
        .map((v) => parseInt(v, 10))
        .filter((n) => Number.isFinite(n))
        .sort((a, b) => a - b);
      const excess = versions.length - max;
      if (excess > 0) {
        const drop = versions.slice(0, excess);
        for (const v of drop) {
          await this.redis.del(getWorkflowVersionKey(wf.userId, wf.id, v));
          await this.redis.srem(idxKey, String(v));
        }
      }
    }
  }

  // Create and persist a new workflow (version 1).
  async create(userId: string, input: WorkflowInput): Promise<Workflow> {
    const id = generateWorkflowId();
    const ts = nowIso();
    const wf: Workflow = {
      id,
      userId,
      name: input.name,
      description: input.description ?? undefined,
      steps: input.steps,
      headless: input.headless ?? undefined,
      webhookUrl: input.webhookUrl ?? undefined,
      version: 1,
      createdAt: ts,
      updatedAt: ts,
    };
    await this.redis.set(getWorkflowKey(userId, id), JSON.stringify(wf));
    await this.redis.sadd(getUserWorkflowsKey(userId), id);
    await this.saveVersion(wf);
    return wf;
  }

  // Fetch a single workflow, or null if it does not exist for this user.
  async get(userId: string, workflowId: string): Promise<Workflow | null> {
    const raw = await this.redis.get(getWorkflowKey(userId, workflowId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Workflow;
    } catch {
      return null;
    }
  }

  // List all workflows owned by a user (newest updated first).
  async list(userId: string): Promise<Workflow[]> {
    const ids = await this.redis.smembers(getUserWorkflowsKey(userId));
    if (!ids.length) return [];
    const out: Workflow[] = [];
    for (const id of ids) {
      const wf = await this.get(userId, id);
      if (wf) out.push(wf);
      else await this.redis.srem(getUserWorkflowsKey(userId), id); // prune dangling id
    }
    out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return out;
  }

  // Update a workflow's editable fields. Bumps version + snapshots the NEW state
  // into history. Returns null if the workflow does not exist for this user.
  async update(
    userId: string,
    workflowId: string,
    input: WorkflowInput
  ): Promise<Workflow | null> {
    const existing = await this.get(userId, workflowId);
    if (!existing) return null;
    const updated: Workflow = {
      ...existing,
      name: input.name,
      description: input.description ?? undefined,
      steps: input.steps,
      headless: input.headless ?? undefined,
      webhookUrl: input.webhookUrl ?? undefined,
      version: existing.version + 1,
      updatedAt: nowIso(),
    };
    await this.redis.set(getWorkflowKey(userId, workflowId), JSON.stringify(updated));
    await this.saveVersion(updated);
    return updated;
  }

  // Delete a workflow and its entire version history. Returns true if it existed.
  async remove(userId: string, workflowId: string): Promise<boolean> {
    const existed = await this.redis.exists(getWorkflowKey(userId, workflowId));
    const idxKey = getWorkflowVersionIndexKey(userId, workflowId);
    const versions = await this.redis.smembers(idxKey);
    for (const v of versions) {
      await this.redis.del(getWorkflowVersionKey(userId, workflowId, parseInt(v, 10)));
    }
    await this.redis.del(idxKey);
    await this.redis.del(getWorkflowKey(userId, workflowId));
    await this.redis.srem(getUserWorkflowsKey(userId), workflowId);
    return existed > 0;
  }

  // List the version history of a workflow (newest version first).
  async listVersions(
    userId: string,
    workflowId: string
  ): Promise<WorkflowVersionSnapshot[]> {
    const idxKey = getWorkflowVersionIndexKey(userId, workflowId);
    const versions = (await this.redis.smembers(idxKey))
      .map((v) => parseInt(v, 10))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => b - a);
    const out: WorkflowVersionSnapshot[] = [];
    for (const v of versions) {
      const raw = await this.redis.get(getWorkflowVersionKey(userId, workflowId, v));
      if (raw) {
        try {
          out.push(JSON.parse(raw) as WorkflowVersionSnapshot);
        } catch {
          /* skip corrupt snapshot */
        }
      }
    }
    return out;
  }
}
