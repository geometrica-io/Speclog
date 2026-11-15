// Tree listings through the build's BlobReader (`git cat-file --batch`) instead of one
// `git ls-tree -r` process per ref: the trees are parsed here and cached by object id, so a
// subtree shared by many branches is read and parsed once per build.
import type { BlobReader } from './blobReader';
import type { RepoResult, TreeBlob } from './repo';

/** One entry of a tree object. */
interface Entry { name: string; oid: string; kind: 'tree' | 'blob' | 'commit'; }

/**
 * Parses git's tree format: `<octal mode> SP <name> NUL <raw oid>` repeated, oidLen bytes per raw
 * oid (20 SHA-1, 32 SHA-256). null when malformed. Names are raw bytes (UTF-8), never quoted.
 */
function parseTree(data: Buffer, oidLen: number): Entry[] | null {
  const out: Entry[] = [];
  let i = 0;
  while (i < data.length) {
    const sp = data.indexOf(0x20, i);
    if (sp === -1) return null;
    const nul = data.indexOf(0, sp + 1);
    if (nul === -1 || nul + 1 + oidLen > data.length) return null;
    const mode = data.toString('latin1', i, sp);
    // 40000 tree, 160000 submodule (a commit); every other mode (100644, 100755, 120000 symlink)
    // is a blob, as ls-tree reports it.
    const kind = mode === '40000' ? 'tree' : mode === '160000' ? 'commit' : 'blob';
    out.push({ name: data.toString('utf8', sp + 1, nul), oid: data.toString('hex', nul + 1, nul + 1 + oidLen), kind });
    i = nul + 1 + oidLen;
  }
  return out;
}

interface Spec { name: string; dir: boolean; }

/**
 * Lists files of a ref like `git ls-tree -r <ref> <pathspecs>` (listTreeBlobs): the same paths,
 * object ids and order. Reads through reader, which the caller owns (and closes).
 */
export class TreeReader {
  private readonly trees = new Map<string, Promise<RepoResult<Entry[]>>>();
  private readonly flats = new Map<string, Promise<RepoResult<TreeBlob[]>>>();
  /** Tree objects parsed so far (tests: the cache). */
  treesParsed = 0;

  constructor(private readonly reader: BlobReader) {}

  /**
   * Files (blobs) at ref under any of pathspecs, recursively: a directory with a trailing "/" or a
   * file or directory path; one that does not exist adds nothing. [] lists nothing.
   */
  async listBlobs(ref: string, pathspecs: string[]): Promise<RepoResult<TreeBlob[]>> {
    if (pathspecs.length === 0) return { value: [], error: '' };
    const root = await this.reader.readRaw(`${ref}^{tree}`);
    if (root.error) return { value: [], error: root.error };
    if (root.value === null || root.value.type !== 'tree') return { value: [], error: `git cat-file: no tree at ${ref}` };
    const raw = root.value;
    const specs = pathspecs.map((s) => ({ name: s.replace(/\/+$/, ''), dir: s.endsWith('/') }));
    return this.walk(raw.oid, '', specs, raw.data);
  }

  /** Parsed tree oid (data: its content when already read). */
  private tree(oid: string, data?: Buffer): Promise<RepoResult<Entry[]>> {
    let p = this.trees.get(oid);
    if (!p) {
      p = (async (): Promise<RepoResult<Entry[]>> => {
        let content = data;
        if (!content) {
          const r = await this.reader.readRaw(oid);
          if (r.error) return { value: [], error: r.error };
          if (r.value === null || r.value.type !== 'tree') return { value: [], error: `git cat-file: could not read tree ${oid}` };
          content = r.value.data;
        }
        this.treesParsed++;
        const entries = parseTree(content, oid.length / 2);
        return entries ? { value: entries, error: '' } : { value: [], error: `git cat-file: malformed tree ${oid}` };
      })();
      this.trees.set(oid, p);
    }
    return p;
  }

  /** Every blob under tree oid, paths relative to it, in tree order. */
  private flat(oid: string): Promise<RepoResult<TreeBlob[]>> {
    let p = this.flats.get(oid);
    if (!p) {
      p = (async (): Promise<RepoResult<TreeBlob[]>> => {
        const t = await this.tree(oid);
        if (t.error) return { value: [], error: t.error };
        const parts = await Promise.all(t.value.map(async (e): Promise<RepoResult<TreeBlob[]>> => {
          if (e.kind === 'blob') return { value: [{ path: e.name, oid: e.oid }], error: '' };
          if (e.kind !== 'tree') return { value: [], error: '' };
          const sub = await this.flat(e.oid);
          return { value: sub.value.map((f) => ({ path: `${e.name}/${f.path}`, oid: f.oid })), error: sub.error };
        }));
        return join(parts);
      })();
      this.flats.set(oid, p);
    }
    return p;
  }

  /** Blobs of tree oid (at prefix, "" or ending in "/") matched by specs, full paths. */
  private async walk(oid: string, prefix: string, specs: Spec[], data?: Buffer): Promise<RepoResult<TreeBlob[]>> {
    const t = await this.tree(oid, data);
    if (t.error) return { value: [], error: t.error };
    const parts = await Promise.all(t.value.map(async (e): Promise<RepoResult<TreeBlob[]>> => {
      const p = prefix + e.name;
      const whole = specs.some((s) => s.name === '' || (s.name === p && (!s.dir || e.kind === 'tree')));
      if (whole) {
        if (e.kind === 'blob') return { value: [{ path: p, oid: e.oid }], error: '' };
        if (e.kind !== 'tree') return { value: [], error: '' };
        const sub = await this.flat(e.oid);
        return { value: sub.value.map((f) => ({ path: `${p}/${f.path}`, oid: f.oid })), error: sub.error };
      }
      if (e.kind !== 'tree') return { value: [], error: '' };
      const under = specs.filter((s) => s.name.startsWith(`${p}/`));
      return under.length > 0 ? this.walk(e.oid, `${p}/`, under) : { value: [], error: '' };
    }));
    return join(parts);
  }
}

/** Concatenation of parts; the first error. */
function join(parts: Array<RepoResult<TreeBlob[]>>): RepoResult<TreeBlob[]> {
  const err = parts.find((x) => x.error)?.error ?? '';
  return { value: err ? [] : parts.flatMap((x) => x.value), error: err };
}
