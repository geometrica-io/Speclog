import type { ParseIssue, Program, SourceFormat } from '../model';

/** One task-related file read from git: repo-relative path with forward slashes, and its text. */
export interface SourceFile {
  path: string;
  text: string;
  /** Git blob object id of text, when known: lets a ParseCache reuse the parse of an identical file. */
  oid?: string;
}

/**
 * Memo of per-file parse steps for one snapshot build: get(key, compute) returns the value stored
 * under key, computing it once. Keys hold the step, the file path(s) and blob id(s), so a file
 * identical on many branches is parsed once and its issues keep their path.
 */
export interface ParseCache {
  get<T>(key: string, compute: () => T): T;
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
  parse(files: SourceFile[], cache?: ParseCache): AdapterResult;
  idsCaseInsensitive: boolean;
}
