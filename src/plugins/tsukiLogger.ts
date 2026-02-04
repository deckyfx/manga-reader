import { Elysia } from "elysia";
import { createLogger } from "tsuki-logger/elysia";

export const TsukiLogger = new Elysia({ name: "tsuki-logger" }).use(
  createLogger({
    level: "debug",
  }),
);

export type TsukiLogger = typeof TsukiLogger.decorator.log;
