import type { Answers } from "@mktrue/contracts";

export type DerivableAnswers = Pick<Answers, "name" | "languages" | "consumers">;

const envKey = (name: string): string => name.toUpperCase().replace(/-/g, "_");

export function derivedValues(answers: DerivableAnswers): Record<string, unknown> {
  const derived: Record<string, unknown> = {
    nameUpper: envKey(answers.name),
    localesLiteral: answers.languages.map((locale) => JSON.stringify(locale)).join(", "),
  };
  if (answers.consumers !== undefined) {
    derived.consumerEnv = answers.consumers
      .map((consumer) => {
        const key = envKey(consumer);
        return `${key}_DB_NAME=${consumer}\n${key}_DB_USER=${consumer}_app\n${key}_DB_PASSWORD=`;
      })
      .join("\n\n");
  }
  return derived;
}
