import type { Finding, Question } from "@mktrue/core";

export interface FileSystem {
  read(path: string): Promise<string | undefined>;
  write(path: string, content: string, executable?: boolean): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  list(dir: string): Promise<string[]>;
}

export type ReadOnlyFileSystem = Pick<FileSystem, "read" | "list">;

export type OpenRepository = (root: string) => Promise<ReadOnlyFileSystem>;

export type OpenBench = (dir: string | undefined) => FileSystem | undefined;

export interface Output {
  /** The width a line is clipped to; 80 when the output names none. */
  readonly columns?: number;
  line(text: string): void;
  finding(finding: Finding): void;
  verdict(text: string): void;
}

export interface TemporaryTree {
  readonly name: string;
  readonly log: string;
  readonly fs: FileSystem;
}

export type TargetState = "missing" | "empty" | "occupied";

export interface Workspace {
  readAnswers(path: string): Promise<string | undefined>;
  inspect(name: string): Promise<TargetState>;
  makeTemporary(name: string): Promise<TemporaryTree>;
  moveIntoPlace(tree: TemporaryTree, name: string): Promise<void>;
  removeTemporary(tree: TemporaryTree): Promise<void>;
  removeLog(tree: TemporaryTree): Promise<void>;
}

export interface Run {
  readonly ok: boolean;
  readonly seconds: number;
}

export interface Runner {
  probe(argv: readonly string[], tree?: TemporaryTree): Promise<string | undefined>;
  run(argv: readonly string[], tree: TemporaryTree): Promise<Run>;
}

export const CANCELLED = "cancelled";

export type Cancelled = typeof CANCELLED;

export interface Prompt {
  readonly interactive: boolean;
  ask(question: Question): Promise<string | Cancelled>;
  confirm(text: string): Promise<boolean | Cancelled>;
}

export interface InterruptGuard {
  /**
   * Arms a handler for the next SIGINT and returns a function that disarms
   * it. `onInterrupt` reports what is being left behind and returns the
   * exit code the process ends with.
   */
  arm(onInterrupt: () => number): () => void;
}

export interface NewPorts {
  readonly workspace: Workspace;
  readonly runner: Runner;
  readonly prompt: Prompt;
  readonly interrupt: InterruptGuard;
  readonly today: () => string;
}

export type LinkInspection =
  | { readonly kind: "missing" }
  | { readonly kind: "link"; readonly realPath: string }
  | { readonly kind: "dangling" }
  | { readonly kind: "other" };

/** Whether a link was made, or the path was found in the way and left alone. */
export type LinkOutcome = "linked" | "in-the-way";

/** What `doctor` reads and writes on the machine it runs on, never the repository. */
export interface Machine {
  nodeVersion(): string;
  configDir(): string;
  /** The first `mktrue` on PATH, resolved with `realpath`; undefined when none is found. */
  whichMktrue(): Promise<string | undefined>;
  /** This running bundle's own realpath. */
  selfPath(): Promise<string>;
  homeDir(): string;
  /** A trusted kit checkout, else the npm package, holding skill/mktrue; undefined if neither. */
  skillHome(): Promise<string | undefined>;
  inspectLink(path: string): Promise<LinkInspection>;
  /** The `name:` frontmatter of `<dir>/SKILL.md`, or undefined if it cannot be read. */
  readSkillName(dir: string): Promise<string | undefined>;
  /** The single `model` key of `<config>/settings.json`; nothing else is read. */
  readSettingsModel(): Promise<string | undefined>;
  /** Links `target` at `path`, which `inspectLink` just found missing. */
  linkFresh(target: string, path: string): Promise<LinkOutcome>;
  /** Replaces `path`, our own link to `expectedRealPath`, with a link to `target`. */
  relinkOurs(target: string, path: string, expectedRealPath: string): Promise<LinkOutcome>;
  /** The realpath of `dir` if it (or an ancestor) is a link; `dir` itself otherwise. */
  realDir(dir: string): Promise<string>;
}

export interface DoctorPorts {
  readonly runner: Runner;
  /** Probes pnpm pinned to the offered templates' own version, never the ambient one. */
  readonly pnpmRunner: Runner;
  readonly machine: Machine;
}

export interface TranscriptEntry {
  readonly name: string;
  readonly kind: "file" | "dir";
}

/** Read-only access to transcripts. Links are listed as what they point at. */
export interface TranscriptStore {
  /** Nothing when `path` cannot be resolved. */
  realPath(path: string): Promise<string | undefined>;
  /** Nothing when `dir` cannot be listed. */
  entries(dir: string): Promise<TranscriptEntry[] | undefined>;
  lines(path: string): AsyncIterable<string>;
  readSmall(path: string): Promise<string | undefined>;
}

export interface AuditPorts {
  readonly runner: Runner;
  readonly store: TranscriptStore;
  readonly configDir: () => string;
  readonly today: () => string;
  readonly cwd: string;
  /** What is at `path` now, without following a link. */
  targetKind(path: string): Promise<"missing" | "file" | "dir" | "other">;
  write(path: string, content: string): Promise<void>;
}

export interface SiblingGit {
  /** The commit a full ref names, or nothing when the ref does not exist. */
  resolve(ref: string): Promise<{ commit: string; short: string } | undefined>;
  /** A file's content at a commit, or nothing when it is not there. */
  read(commit: string, path: string): Promise<string | undefined>;
}

export type LocatedSibling =
  | {
      readonly kind: "found";
      /** Relative to this repository's root. */
      readonly shown: string;
      readonly git: SiblingGit;
      /** From the working-tree `.mktrue.json`: the branch must be known before a ref is read. */
      baseBranch(): Promise<string | undefined>;
      /** Whether one of `entries`, resolved from the sibling, is this repository. */
      listsBack(entries: readonly string[]): Promise<boolean>;
    }
  | {
      readonly kind: "unreadable";
      readonly shown: string | null;
      readonly why: string;
      readonly refused?: true;
    };

export interface SiblingPorts {
  locate(entry: string): Promise<LocatedSibling>;
}
