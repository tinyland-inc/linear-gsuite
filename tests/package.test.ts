import path from "node:path";
import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import { loadCalendarDefinition } from "../src/config.js";

const exampleConfig = path.resolve("examples/tinyland-business-ops/linear-gsuite.package.json");

describe("calendar package loading", () => {
  it("loads the example recurring event package", async () => {
    const definition = await Effect.runPromise(loadCalendarDefinition(exampleConfig));
    expect(definition.format).toBe("calendar-package");
    expect(definition.timezone).toBe("America/New_York");
    expect(definition.events).toHaveLength(8);
    expect(definition.sources).toHaveLength(1);
    expect(definition.events[0]?.sourceId).toBe("business-ops-recurring");
  });
});
