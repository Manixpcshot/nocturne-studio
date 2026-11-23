export type QueueJob = {
  model_id: string;
  count: number;
  prompt: string;
  aspect_ratio: string;
  variations: boolean;
};

type Project = { id: string; name: string };
export type QueueRun = { id: string; folder: string; jobs: QueueJob[] };

export function stored<T>(key: string, fallback: T): T {
  try { return (JSON.parse(localStorage.getItem(key) || 'null') as T | null) ?? fallback; }
  catch { return fallback; }
}

export function newId() {
  return crypto.randomUUID().replaceAll('-', '');
}

const catalogKey = 'nocturne-projects';
const activeKey = 'nocturne-active-project';
export const projects = stored<Project[]>(catalogKey, []);
export let projectId = localStorage.getItem(activeKey) || '';
if (!projects.some(project => project.id === projectId)) projectId = '';

export function activateProject(id: string) {
  if (id && !projects.some(project => project.id === id)) return;
  localStorage.setItem(activeKey, id);
  projectId = id;
}

export function addProject(name: string) {
  const project = { id: newId(), name };
  localStorage.setItem(catalogKey, JSON.stringify([...projects, project]));
  projects.push(project);
  return project.id;
}

export function scopedKey(key: string) {
  return projectId ? key + ':' + projectId : key;
}

const runKey = 'nocturne-pending-queue';
export function pendingQueue() {
  return stored<QueueRun | null>(scopedKey(runKey), null);
}

export function persistQueue(run: QueueRun | null) {
  if (run) localStorage.setItem(scopedKey(runKey), JSON.stringify(run));
  else localStorage.removeItem(scopedKey(runKey));
}

export function buildCombinations(prompts: string[], models: string[], ratios: string[], count: number) {
  return models.flatMap(model_id => prompts.flatMap(prompt => ratios.map(aspect_ratio =>
    ({ model_id, count, prompt, aspect_ratio, variations: false } satisfies QueueJob))));
}

export function relatedImages<T extends { name: string; parent_image?: string }>(images: T[], name: string) {
  const relations = new Map<string, Set<string>>();
  function link(a: string, b: string) {
    if (!relations.has(a)) relations.set(a, new Set());
    relations.get(a)!.add(b);
  }
  for (const item of images) {
    if (!item.parent_image) continue;
    link(item.name, item.parent_image);
    link(item.parent_image, item.name);
  }
  const seen = new Set([name]);
  for (const item of seen) {
    for (const relation of relations.get(item) || []) seen.add(relation);
  }
  return seen;
}
