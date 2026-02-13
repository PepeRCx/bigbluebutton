export interface RedisMessageRouting {
    meetingId: String,
    userId: String
}

export interface RedisMessage {
    eventName: String;
    routing: RedisMessageRouting;
    header: Record<string, unknown>;
    body: Record<string, unknown>;
}

// Support for actions that return multiple messages (e.g., caption translation)
export type RedisMessageOrArray = RedisMessage | RedisMessage[];
