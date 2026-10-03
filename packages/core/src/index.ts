export { EXIT, exitCodeFor } from "./findings.js";
export type { ExitCode, Finding } from "./findings.js";

export {
  SLOT_PATTERN,
  escapeContextForPath,
  escapeForContext,
  formatSlotValue,
  freeTextSlotKeys,
  slotValues,
  slotsIn,
  substitute,
  substituteForFile,
} from "./slots.js";
export type { EscapeContext, Substitution } from "./slots.js";

export { hashContent, stampHeader } from "./stamp.js";

export { characterCount, checkBudgets } from "./budgets.js";
export type { Document } from "./budgets.js";

export {
  benchEntries,
  checkBenchIntegrity,
  checkFreeTextTokenPositions,
  checkGeneratedLockfiles,
  checkTemplateSlots,
} from "./integrity.js";
export type { BenchEntry, SlotTable } from "./integrity.js";

export { checkTiers } from "./tiers.js";

export { checkDocumentPaths } from "./paths.js";
export type { PathMatches } from "./paths.js";

export { checkDrift } from "./drift.js";
export type { DriftInput } from "./drift.js";

export { missingTargetFinding, renderBench, roleFrontmatter } from "./render.js";
export type { RenderedFile, RenderedRegion, RenderedRules } from "./render.js";

export { extractRegion, regionIds, unterminatedRegion, writeRegion } from "./regions.js";

export { planRules } from "./rules.js";
export {
  GATES_FIX,
  checkGates,
  checkSettings,
  denyRules,
  settingsLinkedOutside,
} from "./settings.js";
export type { SettingsCheck } from "./settings.js";
export type { RulesAction, RulesInput, RulesPlan } from "./rules.js";

export { configAfterBench, ownedAfterSync, planBench, planSync, renderBenchFor } from "./sync.js";
export type {
  BenchPlan,
  BenchRender,
  BenchSource,
  SyncAction,
  SyncEntry,
  SyncInput,
  SyncPlan,
} from "./sync.js";

export {
  MIN_TOKENISE_LENGTH,
  applyTransforms,
  compileTransform,
  curatedAfterAdopt,
  importSourcePaths,
  importedAfterAdopt,
  importedAfterWrite,
  planImport,
  tokenise,
} from "./import.js";
export type {
  ImportAction,
  ImportEntry,
  ImportInput,
  ImportPlan,
  ReportedValue,
  Tokenisation,
} from "./import.js";

export { entropyOf, isLiveEnvFile, scanSecrets } from "./secrets.js";

export { includesFile, renderTemplate } from "./template.js";
export type { RenderedTemplateFile } from "./template.js";

export { derivedValues } from "./derived.js";
export type { DerivableAnswers } from "./derived.js";

export { checkComposition, renderComposed } from "./compose.js";
export type { Replacement, TemplateSource } from "./compose.js";

export {
  CONFIG_PATH,
  DEFAULT_AUDIT_TRIGGERS,
  DEFAULT_BUDGETS,
  DEFAULT_REQUIRES,
  OFFERED_TEMPLATES,
  planNew,
  pnpmRequirement,
  pnpmSatisfies,
  requiresFor,
  templateNotOfferedFix,
} from "./new.js";
export type { NewFile, NewInput, NewPlan, PnpmRequirement } from "./new.js";

export {
  answersFromReplies,
  checkReply,
  hasSignIn,
  NO_SIGN_IN,
  parseList,
  questionsFor,
  replyValue,
  titleDefault,
} from "./questions.js";
export type { Question, QuestionKind } from "./questions.js";

export { REQUIRED_PNPM, isOneMillionModel, nodeSatisfies, pnpmPin } from "./doctor.js";

export {
  DEFAULT_GATES,
  OUTSIDE_REPOSITORY,
  auditMetrics,
  renderAuditHtml,
  repoRelative,
} from "./audit.js";
export type { AuditRun, AuditTranscript, AuditTree } from "./audit.js";

export {
  compareSiblings,
  describeRepository,
  pathsToRead,
  planCounts,
  shownSibling,
} from "./siblings.js";
export type {
  DescribeInput,
  PlanStep,
  PlanStepAction,
  RepositoryState,
  SiblingComparison,
  SiblingFinding,
  SiblingInput,
} from "./siblings.js";
