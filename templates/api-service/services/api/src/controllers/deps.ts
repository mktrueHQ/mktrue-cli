import type {
  ExampleItemRepository,
  ExampleNoteRepository,
} from "../contexts/example/application/ports";
import type { UserProfileRepository } from "../contexts/profile/application/ports";
import type { SerializeByUser } from "../contexts/shared/application/ports";

export interface ExampleRouteDeps {
  readonly exampleItemRepository: ExampleItemRepository;
  readonly exampleNoteRepository: ExampleNoteRepository;
  readonly userProfileRepository: Pick<UserProfileRepository, "find">;
  readonly defaultTimeZone: string;
  readonly serialize: SerializeByUser;
}

export interface ProfileRouteDeps {
  readonly userProfileRepository: UserProfileRepository;
}
