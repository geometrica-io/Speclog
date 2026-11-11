import type { SourceFormat } from '../model';
import { backlogMdAdapter } from './backlogMd';
import { docsTasksAdapter } from './docsTasks';
import { specKitAdapter } from './specKit';
import type { TaskSourceAdapter } from './types';

export * from './types';
export { docsTasksAdapter } from './docsTasks';
export { backlogMdAdapter, DEFAULT_BACKLOG_STATUSES } from './backlogMd';
export { specKitAdapter } from './specKit';

export const ADAPTERS: readonly TaskSourceAdapter[] = [docsTasksAdapter, backlogMdAdapter, specKitAdapter];

/** Comparison key for an item id: Backlog.md ids are case-insensitive, the others are not. */
export function normalizeId(format: SourceFormat, id: string): string {
  return ADAPTERS.find((a) => a.format === format)?.idsCaseInsensitive ? id.toLowerCase() : id;
}
