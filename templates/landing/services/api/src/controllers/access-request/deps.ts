import type {
  AccessRequestRepository,
  Clock,
  CodeGenerator,
  Logger,
  Mailer,
  SendBudget,
  TokenSigner,
  WrongCodeCounter,
} from "../../contexts/access-request/application/ports";

/** Everything the two routes need, injected — so a test can drive them without Mongo or Resend. */
export interface AccessRequestRouteDeps {
  readonly mailer: Mailer;
  readonly tokenSigner: TokenSigner;
  readonly clock: Clock;
  readonly codeGenerator: CodeGenerator;
  readonly repository: AccessRequestRepository;
  readonly logger: Logger;
  readonly sendBudget: SendBudget;
  readonly dailySendLimit: number;
  /** How many token digests a mailbox row remembers — sized in `config.ts`. */
  readonly verificationMemory: number;
  readonly wrongCodes: WrongCodeCounter;
  readonly destinationEmail: string;
}
