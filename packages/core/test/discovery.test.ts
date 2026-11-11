// Port of ProjectManager tests/RepoScannerTests.cpp (same case names) plus Speclog extras.
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { runGit } from '../src/git/runner';
import { discoverRepos, originMatches, parseOrigin, DiscoverOptions } from '../src/discovery';
import { makeTempDir, removeTree } from './helpers/testRepo';

const T = 60000;
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) removeTree(dirs.pop()!);
});
function tempRoot(): string {
  const d = makeTempDir('scan');
  dirs.push(d);
  return d;
}
async function initRepo(dir: string, origin = ''): Promise<void> {
  fs.mkdirSync(dir, { recursive: true });
  await runGit(dir, ['init', '-q']);
  if (origin) await runGit(dir, ['remote', 'add', 'origin', origin]);
}
function opts(o: Partial<DiscoverOptions>): DiscoverOptions {
  return { workspaceFolders: [], roots: [], exclude: [], originFilter: [], ...o };
}
const OVA = ['github.com/ovasoft41/'];

describe('discoverRepos', () => {
  it('discovers repos with git dir and matching origin', async () => {
    const root = tempRoot();
    await initRepo(`${root}/A`, 'https://github.com/ovasoft41/A.git');
    // worktree look-alike: .git is a file
    fs.mkdirSync(`${root}/B`, { recursive: true });
    fs.writeFileSync(`${root}/B/.git`, 'gitdir: ../A/.git\n');
    await initRepo(`${root}/C`, 'https://github.com/emscripten-core/emsdk.git');

    const repos = await discoverRepos(opts({ roots: [root], originFilter: OVA }));
    expect(repos.length).toBe(1);
    expect(repos[0].name).toBe('A');
    expect(repos[0].owner).toBe('ovasoft41');
    expect(repos[0].origin).toBe('https://github.com/ovasoft41/A.git');
    expect(repos[0].key).toBe('https://github.com/ovasoft41/A');
    expect(path.basename(repos[0].path)).toBe('A');
    expect(path.isAbsolute(repos[0].path)).toBe(true);

    expect(await discoverRepos(opts({ roots: [root], originFilter: OVA, exclude: ['A'] }))).toEqual([]);
    expect(await discoverRepos(opts({ roots: ['C:/no/such/root'], workspaceFolders: ['C:/no/such/ws'] }))).toEqual([]);
  }, T);

  it('discovered repos are sorted by name', async () => {
    const root = tempRoot();
    await initRepo(`${root}/zeta`, 'https://github.com/ovasoft41/zeta.git');
    await initRepo(`${root}/alpha`, 'https://github.com/ovasoft41/alpha.git');
    await initRepo(`${root}/Mid`, 'https://github.com/ovasoft41/Mid.git');
    const repos = await discoverRepos(opts({ roots: [root] }));
    expect(repos.map((r) => r.name)).toEqual(['alpha', 'Mid', 'zeta']); // case-insensitive
  }, T);

  it('origin filter accepts https and ssh, any case', async () => {
    const f = 'github.com/ovasoft41/';
    expect(originMatches('https://github.com/ovasoft41/A.git', f)).toBe(true);
    expect(originMatches('git@github.com:ovasoft41/A.git', f)).toBe(true);
    expect(originMatches('ssh://git@github.com/ovasoft41/A.git', f)).toBe(true);
    expect(originMatches('https://GitHub.com/OvaSoft41/A.git', f)).toBe(true);
    expect(originMatches('https://github.com/emscripten-core/emsdk.git', f)).toBe(false);
    expect(originMatches('https://example.com/ovasoft41/A.git', f)).toBe(false);
    expect(originMatches('anything', '')).toBe(true);

    const root = tempRoot();
    await initRepo(`${root}/Ssh`, 'git@github.com:ovasoft41/Ssh.git');
    await initRepo(`${root}/Upper`, 'https://GITHUB.com/OVASOFT41/Upper.git');
    const repos = await discoverRepos(opts({ roots: [root], originFilter: OVA }));
    expect(repos.map((r) => r.name)).toEqual(['Ssh', 'Upper']);
    expect(repos[1].key).toBe('https://github.com/OVASOFT41/Upper');
  }, T);

  // --- Speclog extras ---

  it('ssh origin matches filter', async () => {
    // Filter written in ssh form matches an https origin and the other way round.
    expect(originMatches('https://github.com/geometrica-io/x.git', 'git@github.com:Geometrica-IO/')).toBe(true);
    expect(originMatches('git@github.com:geometrica-io/x.git', 'github.com/geometrica-io/')).toBe(true);
    expect(originMatches('git@gitlab.example.com:team/x.git', 'gitlab.example.com/team/')).toBe(true);
    expect(originMatches('git@github.com:other/x.git', 'github.com/geometrica-io/')).toBe(false);

    const root = tempRoot();
    await initRepo(`${root}/one`, 'git@github.com:geometrica-io/one.git');
    await initRepo(`${root}/two`, 'https://github.com/someone/two.git');
    await initRepo(`${root}/three`); // no origin: never matches a non-empty filter
    const repos = await discoverRepos(opts({ roots: [root], originFilter: ['github.com/ovasoft41/', 'github.com/geometrica-io/'] }));
    expect(repos.map((r) => r.name)).toEqual(['one']);
    expect(repos[0].owner).toBe('geometrica-io');
    expect(repos[0].key).toBe('git@github.com:geometrica-io/one');
  }, T);

  it('repo name from origin URL, folder name without origin', async () => {
    expect(parseOrigin('https://github.com/Owner/Name.git')).toEqual({ owner: 'Owner', name: 'Name', key: 'https://github.com/Owner/Name' });
    expect(parseOrigin('https://user@GitHub.COM/Owner/Name/')).toEqual({ owner: 'Owner', name: 'Name', key: 'https://github.com/Owner/Name' });
    expect(parseOrigin('git@GitHub.com:Owner/Name.git')).toEqual({ owner: 'Owner', name: 'Name', key: 'git@github.com:Owner/Name' });
    expect(parseOrigin('ssh://git@github.com:22/Owner/Name.git')).toEqual({ owner: 'Owner', name: 'Name', key: 'ssh://github.com:22/Owner/Name' });
    expect(parseOrigin('C:/local/bare.git')).toBeNull();
    expect(parseOrigin('')).toBeNull();

    const root = tempRoot();
    await initRepo(`${root}/local-folder`, 'https://github.com/ovasoft41/RealName.git');
    await initRepo(`${root}/Proje Ç ğ`); // no origin, spaces and non-ASCII characters
    const repos = await discoverRepos(opts({ roots: [root] }));
    expect(repos.length).toBe(2);
    const named = repos.find((r) => r.origin !== '')!;
    expect(named.name).toBe('RealName');
    expect(named.owner).toBe('ovasoft41');
    const plain = repos.find((r) => r.origin === '')!;
    expect(plain.name).toBe('Proje Ç ğ');
    expect(plain.owner).toBe('');
    expect(plain.key).toBe(plain.path);
    expect(plain.path).toBe(fs.realpathSync.native(`${root}/Proje Ç ğ`));
  }, T);

  it('same repo via workspace folder and root appears once', async () => {
    const root = tempRoot();
    await initRepo(`${root}/A`, 'https://github.com/ovasoft41/A.git');
    await initRepo(`${root}/B`);
    // A twice (as a workspace folder, spelled differently, and as a child of a root);
    // B once as a workspace folder only.
    const repos = await discoverRepos(opts({
      workspaceFolders: [`${root}/A/`, path.join(root, 'B'), `${root}/A`],
      roots: [root, `${root}/./`],
    }));
    expect(repos.map((r) => r.name)).toEqual(['A', 'B']);

    // A workspace folder that is not a repo contributes its direct children.
    const viaWs = await discoverRepos(opts({ workspaceFolders: [root] }));
    expect(viaWs.map((r) => r.name)).toEqual(['A', 'B']);
  }, T);
});
