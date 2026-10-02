export class ExampleStorageUnavailableError extends Error {
  constructor() {
    super("example storage is not connected");
    this.name = "ExampleStorageUnavailableError";
  }
}

export class ExampleItemNotFoundError extends Error {
  constructor() {
    super("no such example item for this user");
    this.name = "ExampleItemNotFoundError";
  }
}

export class TooManyExampleNotesError extends Error {
  constructor() {
    super("this example item already holds as many notes as it may");
    this.name = "TooManyExampleNotesError";
  }
}
