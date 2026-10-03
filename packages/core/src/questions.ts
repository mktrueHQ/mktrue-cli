import { answersSchema, portSchema, type Answers } from "@mktrue/contracts";

export type QuestionKind = "text" | "list" | "port";

export interface Question {
  readonly key: string;
  readonly label: string;
  readonly hint: string;
  readonly kind: QuestionKind;
  readonly default: string | undefined;
}

const BASE_QUESTIONS: readonly Question[] = [
  {
    key: "purpose",
    label: "purpose",
    hint: "what it does, for whom, in one line",
    kind: "text",
    default: undefined,
  },
  {
    key: "owner",
    label: "owner",
    hint: "who is accountable for it",
    kind: "text",
    default: undefined,
  },
  {
    key: "audienceTest",
    label: "audience",
    hint: "who tries it first, and where",
    kind: "text",
    default: undefined,
  },
  {
    key: "stakes",
    label: "stakes",
    hint: "what is lost if it is wrong",
    kind: "text",
    default: undefined,
  },
  {
    key: "dataClasses",
    label: "data",
    hint: "the kinds of data it holds, comma-separated",
    kind: "list",
    default: undefined,
  },
  {
    key: "auth",
    label: "sign-in",
    hint: "how someone proves who they are",
    kind: "text",
    default: "clerk",
  },
  {
    key: "languages",
    label: "languages",
    hint: "the languages it speaks, comma-separated",
    kind: "list",
    default: "en",
  },
];

const PORT_QUESTIONS: Readonly<Record<"web" | "api", Question>> = {
  web: {
    key: "ports.web",
    label: "web port",
    hint: "the port the web app listens on",
    kind: "port",
    default: "4100",
  },
  api: {
    key: "ports.api",
    label: "api port",
    hint: "the port the api listens on",
    kind: "port",
    default: "4101",
  },
};

/** `strafe-landing` -> `Strafe Landing`: each hyphen-separated word capitalised. */
export function titleDefault(name: string): string {
  return name
    .split("-")
    .filter((word) => word.length > 0)
    .map((word) => `${word[0]!.toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function titleQuestion(name: string | undefined): Question {
  return {
    key: "title",
    label: "title",
    hint: "the name people read on the page",
    kind: "text",
    default: name === undefined ? undefined : titleDefault(name),
  };
}

/** `strafe-infrastructure` -> `strafe`; a name without that suffix defaults to itself. */
function consumersDefault(name: string | undefined): string | undefined {
  if (name === undefined) return undefined;
  return name.endsWith("-infrastructure") ? name.slice(0, -"-infrastructure".length) : name;
}

function consumersQuestion(name: string | undefined): Question {
  return {
    key: "consumers",
    label: "consumers",
    hint: "the products this instance serves, comma-separated",
    kind: "list",
    default: consumersDefault(name),
  };
}

const WITHOUT_SIGN_IN: readonly string[] = ["landing", "infrastructure"];

export const NO_SIGN_IN = "none";

export function hasSignIn(template: string): boolean {
  return !WITHOUT_SIGN_IN.includes(template);
}

const UNSIGNED_QUESTIONS = BASE_QUESTIONS.filter((question) => question.key !== "auth");

export function questionsFor(template: string, name?: string): readonly Question[] {
  if (template === "application")
    return [...BASE_QUESTIONS, PORT_QUESTIONS.web, PORT_QUESTIONS.api];
  if (template === "api-service") return [...BASE_QUESTIONS, PORT_QUESTIONS.api];
  if (template === "landing") return [...UNSIGNED_QUESTIONS, titleQuestion(name)];
  if (template === "infrastructure") return [...UNSIGNED_QUESTIONS, consumersQuestion(name)];
  return [];
}

export function parseList(raw: string): string[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

interface CheckableSchema {
  safeParse(value: unknown): {
    success: boolean;
    error?: { issues: readonly { message: string }[] };
  };
}

function fieldSchema(question: Question): CheckableSchema | undefined {
  if (question.kind === "port") return portSchema as CheckableSchema;
  const shape = answersSchema.shape as Record<string, CheckableSchema | undefined>;
  return shape[question.key];
}

export function replyValue(kind: QuestionKind, raw: string): unknown {
  if (kind === "list") return parseList(raw);
  if (kind === "port") {
    const trimmed = raw.trim();
    return /^\d+$/.test(trimmed) ? Number(trimmed) : Number.NaN;
  }
  return raw.trim();
}

export function checkReply(question: Question, raw: string): string | undefined {
  const value = replyValue(question.kind, raw);
  const schema = fieldSchema(question);
  if (schema === undefined) return "no field to check this reply against";
  const result = schema.safeParse(value);
  if (result.success) return undefined;
  return result.error?.issues[0]?.message ?? "invalid";
}

export function answersFromReplies(
  name: string,
  template: string,
  replies: Readonly<Record<string, string>>,
): Answers {
  const reply = (key: string) => replies[key] ?? "";
  const ports: Record<string, number> = {};
  for (const question of questionsFor(template)) {
    if (question.kind !== "port") continue;
    const portKey = question.key.split(".")[1]!;
    ports[portKey] = replyValue("port", reply(question.key)) as number;
  }
  return {
    name,
    ...(template === "landing" ? { title: reply("title").trim() } : {}),
    purpose: reply("purpose").trim(),
    owner: reply("owner").trim(),
    audienceTest: reply("audienceTest").trim(),
    stakes: reply("stakes").trim(),
    dataClasses: parseList(reply("dataClasses")),
    auth: hasSignIn(template) ? reply("auth").trim() : NO_SIGN_IN,
    ports,
    languages: parseList(reply("languages")),
    siblings: [],
    ...(template === "infrastructure" ? { consumers: parseList(reply("consumers")) } : {}),
    skills: [],
  };
}
