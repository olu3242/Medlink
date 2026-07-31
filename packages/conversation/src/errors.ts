export type ConversationErrorCode =
  | "conversation_not_found"
  | "invalid_channel_identity";

export class ConversationError extends Error {
  constructor(
    message: string,
    readonly code: ConversationErrorCode,
    readonly status: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class ConversationNotFoundError extends ConversationError {
  constructor(id: string) {
    super(`Conversation '${id}' was not found`, "conversation_not_found", 404);
  }
}
