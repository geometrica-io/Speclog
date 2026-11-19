// Every webview text, through vscode.l10n.t (literal calls, so the l10n tooling can extract them).
// "{0}" placeholders are passed through as "{0}" and filled in by the webview.
import * as vscode from 'vscode';
import type { AgentBlock, Guard } from '@speclog/core';
import type { Strings } from './protocol';
import type { ReportStrings } from './report/reportStrings';

const P0 = '{0}', P1 = '{1}', P2 = '{2}';

export function webviewStrings(): Strings {
  return {
    'view': vscode.l10n.t('View'),
    'view.program': vscode.l10n.t('Program'),
    'view.area': vscode.l10n.t('Area'),
    'view.time': vscode.l10n.t('Time'),
    'sort': vscode.l10n.t('Sort'),
    'sort.created-asc': vscode.l10n.t('Created ↑'),
    'sort.created-desc': vscode.l10n.t('Created ↓'),
    'sort.activity-asc': vscode.l10n.t('Last activity ↑'),
    'sort.activity-desc': vscode.l10n.t('Last activity ↓'),
    'search': vscode.l10n.t('Search id, title, note'),
    'filter': vscode.l10n.t('Filter'),
    'filter.presets': vscode.l10n.t('Presets'),
    'filter.status': vscode.l10n.t('Status'),
    'filter.repositories': vscode.l10n.t('Repositories'),
    'filter.size': vscode.l10n.t('Size'),
    'filter.noSize': vscode.l10n.t('No size'),
    'preset.all': vscode.l10n.t('All'),
    'preset.open': vscode.l10n.t('Open work'),
    'preset.done': vscode.l10n.t('Done'),
    'preset.onBranch': vscode.l10n.t('On branch'),
    'preset.bugs': vscode.l10n.t('Bugs'),
    'summary': vscode.l10n.t('{0} repos · {1} items · {2} done', P0, P1, P2),
    'summary.unverified': vscode.l10n.t('{0} unverified', P0),
    'shown': vscode.l10n.t('{0} / {1} shown', P0, P1),
    'attention': vscode.l10n.t('Attention ({0})', P0),
    'scanning': vscode.l10n.t('Scanning…'),
    'fetched': vscode.l10n.t('Fetched {0}', P0),
    'notFetched': vscode.l10n.t('Not fetched yet'),
    'fetchFailing': vscode.l10n.t('Failing since {0}: {1}', P0, P1),
    'noRepositories': vscode.l10n.t('No repositories'),
    'status.open': vscode.l10n.t('Not started'),
    'status.partial': vscode.l10n.t('Partial'),
    'status.bug': vscode.l10n.t('Bug'),
    'status.verify': vscode.l10n.t('Needs verification'),
    'status.decision': vscode.l10n.t('Needs decision'),
    'status.dropped': vscode.l10n.t('Dropped'),
    'status.done': vscode.l10n.t('Done'),
    'status.onBranch': vscode.l10n.t('On branch'),
    'status.unverified': vscode.l10n.t('Unverified'),
    'tree.empty': vscode.l10n.t('No task items found.'),
    'tree.noMatch': vscode.l10n.t('No items match the filter.'),
    'tree.scanning': vscode.l10n.t('Scanning repositories…'),
    'tree.label': vscode.l10n.t('Tasks'),
    'props.title': vscode.l10n.t('Properties'),
    'props.empty': vscode.l10n.t('Select an item or a branch in the tree.'),
    'group.item': vscode.l10n.t('Item'),
    'group.description': vscode.l10n.t('Description'),
    'group.source': vscode.l10n.t('Source and trace'),
    'group.evidence': vscode.l10n.t('Evidence'),
    'group.summary': vscode.l10n.t('Summary'),
    'group.byStatus': vscode.l10n.t('By status'),
    'group.oldest': vscode.l10n.t('Oldest open item'),
    'row.id': vscode.l10n.t('Id'),
    'row.title': vscode.l10n.t('Title'),
    'row.status': vscode.l10n.t('Status'),
    'row.size': vscode.l10n.t('Size'),
    'row.priority': vscode.l10n.t('Priority'),
    'row.area': vscode.l10n.t('Area'),
    'row.created': vscode.l10n.t('Created'),
    'row.lastActivity': vscode.l10n.t('Last activity'),
    'row.note': vscode.l10n.t('Note'),
    'row.depends': vscode.l10n.t('Depends'),
    'row.spec': vscode.l10n.t('Spec'),
    'row.taskFile': vscode.l10n.t('Task file'),
    'row.inFile': vscode.l10n.t('In file'),
    'row.branches': vscode.l10n.t('Branches'),
    'row.commits': vscode.l10n.t('Commits'),
    'row.completion': vscode.l10n.t('Completion'),
    'row.expression': vscode.l10n.t('Expression'),
    'row.result': vscode.l10n.t('Result'),
    'row.name': vscode.l10n.t('Name'),
    'row.items': vscode.l10n.t('Items'),
    'row.done': vscode.l10n.t('Done'),
    'row.progress': vscode.l10n.t('Progress'),
    'row.item': vscode.l10n.t('Item'),
    'agent.send': vscode.l10n.t('Send to agent'),
    'note.branchOnly': vscode.l10n.t('new item on a branch'),
    'note.history': vscode.l10n.t('history'),
    'note.trusted': vscode.l10n.t('from file'),
    'note.flagged': vscode.l10n.t('file only, no commit'),
    'commits.none': vscode.l10n.t('none yet'),
    'commit.closes': vscode.l10n.t('Closes the item (Task:)'),
    'commit.progress': vscode.l10n.t('Progress (Task-Progress:)'),
    'commit.copy': vscode.l10n.t('Click to copy the full hash'),
    'dep.notFound': vscode.l10n.t('not found'),
    'spec.missing': vscode.l10n.t('File not found'),
    'spec.outside': vscode.l10n.t('Path is outside the repository'),
    'evidence.found': vscode.l10n.t('found'),
    'evidence.notFound': vscode.l10n.t('not found'),
    'evidence.unchecked': vscode.l10n.t('not checked (bad expression)'),
    'evidence.conflict': vscode.l10n.t('conflicts with the status'),
    'history': vscode.l10n.t('history'),
    'att.empty': vscode.l10n.t('Nothing needs attention.'),
    'att.repository': vscode.l10n.t('Repository'),
    'att.reference': vscode.l10n.t('Reference'),
    'att.detail': vscode.l10n.t('Detail'),
    'att.trust': vscode.l10n.t('Trust current task files'),
    'kind.staleBranch': vscode.l10n.t('Stale branches'),
    'kind.untaggedCommit': vscode.l10n.t('Commits without a task id'),
    'kind.evidenceConflict': vscode.l10n.t('Evidence conflicts'),
    'kind.unknownRef': vscode.l10n.t('Unknown task ids'),
    'kind.formatIssue': vscode.l10n.t('Format issues'),
    'kind.duplicateId': vscode.l10n.t('Duplicate ids'),
    'kind.noTaskFiles': vscode.l10n.t('Repositories without task files'),
    'kind.historyDoneAfterSince': vscode.l10n.t('Done written after the conversion'),
    'kind.fetchFailing': vscode.l10n.t('Fetch failing'),
    'kind.gitError': vscode.l10n.t('Git errors'),
    'kind.gitDoneFileOpen': vscode.l10n.t('Done by git, open in the file'),
    'kind.unverifiedSummary': vscode.l10n.t('Unverified items'),
    'kind.uncommittedTaskChanges': vscode.l10n.t('Uncommitted task file changes'),
    'kind.ambiguousRepoRef': vscode.l10n.t('Ambiguous repository names'),
    'detail.staleBranch': vscode.l10n.t('{0} days old; items: {1}', P0, P1),
    'detail.evidence.presentFound': vscode.l10n.t('Text found, but the item is not done'),
    'detail.evidence.presentMissing': vscode.l10n.t('Text missing, but the item is done'),
    'detail.evidence.absentFound': vscode.l10n.t('Text still present, but the item is done'),
    'detail.evidence.absentMissing': vscode.l10n.t('Text gone, but the item is not done'),
    'detail.unknownRef': vscode.l10n.t('Task: {0} matches no item', P0),
    'detail.duplicateId': vscode.l10n.t('In {0}', P0),
    'detail.noTaskFiles': vscode.l10n.t('No task files on the main branch'),
    'detail.historyDoneAfterSince': vscode.l10n.t('status: done written after .since in {0}', P0),
    'detail.gitDoneFileOpen': vscode.l10n.t('A commit closes it; the file says {0}', P0),
    'detail.unverifiedSummary': vscode.l10n.t('{0} items are done only in the task files, with no commit as evidence. Run "Speclog: Trust current task files" to trust these file statuses.', P0),
    'detail.uncommittedTaskChanges': vscode.l10n.t('Task files have uncommitted changes; the committed state is shown'),
    'detail.ambiguousRepoRef': vscode.l10n.t('"{0}" names several repositories', P0),
    'issue.syntax': vscode.l10n.t('Syntax error'),
    'issue.duplicate-id': vscode.l10n.t('Duplicate id in file'),
    'issue.unknown-field': vscode.l10n.t('Unknown field'),
    'issue.bad-status': vscode.l10n.t('Bad status'),
    'issue.missing-status': vscode.l10n.t('Missing status'),
    'issue.bad-date': vscode.l10n.t('Bad date'),
    'issue.bad-size': vscode.l10n.t('Bad size'),
    'issue.bad-evidence': vscode.l10n.t('Bad evidence'),
    'issue.bad-since': vscode.l10n.t('Bad .since'),
    'issue.bad-trust': vscode.l10n.t('Bad trust cutoff'),
    'issue.done-without-since': vscode.l10n.t('status: done without a .since file'),
    'issue.unsupported': vscode.l10n.t('Unsupported configuration'),
  };
}

/** Core labels shown in the tree (placeholders and catch-all branches). */
export function translateCoreLabel(english: string): string {
  switch (english) {
    case 'Git error': return vscode.l10n.t('Git error');
    case 'No task files': return vscode.l10n.t('No task files');
    case 'No task items': return vscode.l10n.t('No task items');
    case '(no area)': return vscode.l10n.t('(no area)');
    case '(no date)': return vscode.l10n.t('(no date)');
    default: return english;
  }
}

/** Why an item cannot be sent to an agent (core gives the kind, the wording is here). */
export function agentBlockText(b: AgentBlock): string {
  switch (b.kind) {
    case 'closed': return b.status === 'done'
      ? vscode.l10n.t('The item is already done.')
      : vscode.l10n.t('The item is already dropped.');
    case 'notScanned': return vscode.l10n.t('Repository not scanned yet.');
    case 'gitError': return vscode.l10n.t('Git failed for this repository: {0}', b.error);
  }
}

/** One line of the confirmation shown before sending an item with guards. */
export function agentGuardText(g: Guard): string {
  switch (g.kind) {
    case 'decision': return vscode.l10n.t('This item is a pending decision.');
    case 'openDepends': return vscode.l10n.t('Depends on items that are not done: {0}.',
      g.depends.map((d) => (d.found ? d.id : vscode.l10n.t('{0} (not found)', d.id))).join(', '));
    case 'onBranch': return g.branches.length > 0
      ? vscode.l10n.t('Work on this item is already on branch {0}.', g.branches.join(', '))
      : vscode.l10n.t('Work on this item is already on another branch.');
    case 'unverified': return vscode.l10n.t('The file says done but there is no evidence in git.');
  }
}

/** Labels of the report renderers (HTML export and report tab). */
export function reportStrings(): ReportStrings {
  return {
    title: vscode.l10n.t('Speclog report'),
    summary: vscode.l10n.t('Summary'),
    finished: vscode.l10n.t('Finished'),
    inProgress: vscode.l10n.t('In progress'),
    added: vscode.l10n.t('Added'),
    remaining: vscode.l10n.t('Remaining'),
    reopened: vscode.l10n.t('Reopened'),
    droppedOrRemoved: vscode.l10n.t('Dropped or removed'),
    total: vscode.l10n.t('Total'),
    repository: vscode.l10n.t('Repository'),
    period: vscode.l10n.t('Period'),
    start: vscode.l10n.t('Start'),
    end: vscode.l10n.t('End'),
    delta: vscode.l10n.t('Change (points)'),
    colId: vscode.l10n.t('ID'),
    colTitle: vscode.l10n.t('Title'),
    colProgram: vscode.l10n.t('Program'),
    colClosed: vscode.l10n.t('Closed'),
    colReason: vscode.l10n.t('Reason'),
    colStatus: vscode.l10n.t('Status'),
    colChange: vscode.l10n.t('Change'),
    colProgress: vscode.l10n.t('Progress'),
    changeDropped: vscode.l10n.t('Dropped'),
    changeRemoved: vscode.l10n.t('Removed'),
    isNew: vscode.l10n.t('New'),
    onBranch: vscode.l10n.t('On branch {0}'),
    newOnBranch: vscode.l10n.t('New on branch {0}'),
    partial: vscode.l10n.t('Partial'),
    progressCommit: vscode.l10n.t('Progress commit {0}'),
    footer: vscode.l10n.t('Counts cover main; work on branches is listed under In progress.'),
    pastEndNote: vscode.l10n.t('On branch is known only for periods that end today.'),
    generated: vscode.l10n.t('Generated {0}'),
    repositories: vscode.l10n.t('Repositories: {0}'),
    speclog: vscode.l10n.t('Speclog {0}'),
    showItems: vscode.l10n.t('{0} items'),
    status: {
      open: vscode.l10n.t('Not started'),
      partial: vscode.l10n.t('Partial'),
      bug: vscode.l10n.t('Bug'),
      verify: vscode.l10n.t('Needs verification'),
      decision: vscode.l10n.t('Needs decision'),
      dropped: vscode.l10n.t('Dropped'),
      done: vscode.l10n.t('Done'),
      onBranch: vscode.l10n.t('On branch'),
      unverified: vscode.l10n.t('Unverified'),
    },
  };
}
