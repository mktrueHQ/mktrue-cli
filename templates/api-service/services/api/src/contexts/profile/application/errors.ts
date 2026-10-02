export class ProfileStorageUnavailableError extends Error {
  constructor() {
    super("profile storage is not connected");
    this.name = "ProfileStorageUnavailableError";
  }
}
