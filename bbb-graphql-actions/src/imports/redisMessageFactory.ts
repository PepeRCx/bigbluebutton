import { RedisMessage, RedisMessageOrArray } from "../types";
import {ValidationError} from "../types/ValidationError";

export const redisMessageFactory = {
  async buildMessage(sessionVariables: Record<string, unknown>, actionName: string, input: Record<string, unknown>): Promise<RedisMessage[]> {
    try {
      const action = await import(`../actions/${actionName}`);
      const result: RedisMessageOrArray = await action.default(sessionVariables, input);

      // Normalize to array (support both single message and array of messages)
      if (Array.isArray(result)) {
        return result;
      }
      return [result];
    } catch (error) {
      if (error instanceof ValidationError) {
        console.error(`Error importing or executing action "${actionName}":`, error.message);
        console.debug(sessionVariables);
        console.debug(input);
      } else {
        console.error(`Error importing or executing action "${actionName}":`, error);
      }
      throw error;
    }
  },
};
