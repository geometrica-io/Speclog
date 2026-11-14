import type { ParseIssue, Program, SourceFormat } from '../model';

/** One task-related file read from git: repo-relative path with forward slashes, and its text. */
export interface SourceFile {
  path: string;
  text: string;
}

export interface AdapterResult {
  programs: Program[];
  issues: ParseIssue[];
}

/** Converts one task file format into the common model (spec §4.1–§4.3). */
export interface TaskSourceAdapter {
  format: SourceFormat;
  /** Git pathspecs that cover every file the adapter may read (plain paths: ls-tree takes no pathspec magic). */
  pathspecs: string[];
  /**
   * Narrower pathspecs (magic allowed) for "git status": exactly the files the adapter reads, so other
   * files under pathspecs do not count as uncommitted task changes. Default: pathspecs.
   */
  statusPathspecs?: string[];
  /** Picks, from the listed repo paths, the files the adapter parses. */
  select(paths: string[]): string[];
  parse(files: SourceFile[]): AdapterResult;
  idsCaseInsensitive: boolean;
}
