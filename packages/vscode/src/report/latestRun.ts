// Keeps only the newest report computation alive: starting one aborts the one before. Pure (no vscode).

export interface Run {
  signal: AbortSignal;
  /** True only while this is the newest run and it was not cancelled. */
  isCurrent(): boolean;
}

export class LatestRun {
  private current: AbortController | undefined;

  begin(): Run {
    this.current?.abort();
    const c = new AbortController();
    this.current = c;
    return { signal: c.signal, isCurrent: () => this.current === c && !c.signal.aborted };
  }

  cancel(): void {
    this.current?.abort();
    this.current = undefined;
  }
}
