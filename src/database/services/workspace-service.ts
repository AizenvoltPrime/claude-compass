import type { Knex } from 'knex';
import type { WorkspaceProject, CreateWorkspaceProject, WorkspaceType } from '../models';

export async function createWorkspaceProject(
  db: Knex,
  data: CreateWorkspaceProject
): Promise<WorkspaceProject> {
  const [workspaceProject] = await db('workspace_projects').insert(data).returning('*');
  return workspaceProject as WorkspaceProject;
}

export async function getWorkspaceProject(
  db: Knex,
  id: number
): Promise<WorkspaceProject | null> {
  const workspaceProject = await db('workspace_projects').where({ id }).first();
  return (workspaceProject as WorkspaceProject) || null;
}

export async function getWorkspaceProjectsByRepository(
  db: Knex,
  repoId: number
): Promise<WorkspaceProject[]> {
  const workspaceProjects = await db('workspace_projects')
    .where({ repo_id: repoId })
    .orderBy('project_name');
  return workspaceProjects as WorkspaceProject[];
}

export async function getWorkspaceProjectsByType(
  db: Knex,
  repoId: number,
  workspaceType: WorkspaceType
): Promise<WorkspaceProject[]> {
  const workspaceProjects = await db('workspace_projects')
    .where({ repo_id: repoId, workspace_type: workspaceType })
    .orderBy('project_name');
  return workspaceProjects as WorkspaceProject[];
}

export async function getRootWorkspaceProjects(
  db: Knex,
  repoId: number
): Promise<WorkspaceProject[]> {
  const workspaceProjects = await db('workspace_projects')
    .where({ repo_id: repoId })
    .whereNull('parent_project_id')
    .orderBy('project_name');
  return workspaceProjects as WorkspaceProject[];
}

export async function getChildWorkspaceProjects(
  db: Knex,
  parentProjectId: number
): Promise<WorkspaceProject[]> {
  const workspaceProjects = await db('workspace_projects')
    .where({ parent_project_id: parentProjectId })
    .orderBy('project_name');
  return workspaceProjects as WorkspaceProject[];
}

export async function findWorkspaceProjectByPath(
  db: Knex,
  repoId: number,
  projectPath: string
): Promise<WorkspaceProject | null> {
  const workspaceProject = await db('workspace_projects')
    .where({ repo_id: repoId, project_path: projectPath })
    .first();
  return (workspaceProject as WorkspaceProject) || null;
}
