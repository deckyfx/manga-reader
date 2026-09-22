/**
 * The tag limits every series form checks before sending: the same numbers the series route enforces, so a form
 * says what's wrong instead of the server refusing the whole series.
 */
import { describe, expect, test } from "bun:test";
import { MAX_SERIES_TAGS, MAX_TAG_LENGTH, splitTags, tagProblem } from "@/shared/tags";
import { call, signedIn } from "./harness";

describe("series tags", () => {
  test("a tag field reads as trimmed, lower-case tags, each once", () => {
    expect(splitTags(" Parody:Azur Lane, , character:some name,parody:azur lane ")).toEqual(["parody:azur lane", "character:some name"]);
  });

  test("too many tags, or one too long, is named before sending", () => {
    expect(tagProblem(["a", "b"])).toBeNull();
    expect(tagProblem(Array.from({ length: MAX_SERIES_TAGS + 1 }, (_, i) => `t${i}`))).toContain(`at most ${MAX_SERIES_TAGS}`);
    expect(tagProblem(["x".repeat(MAX_TAG_LENGTH + 1)])).toContain(`${MAX_TAG_LENGTH} characters`);
  });

  test("what the check lets through, the series route takes; what it stops, the route refuses", async () => {
    const { cookie } = await signedIn("contributor");
    const most = Array.from({ length: MAX_SERIES_TAGS }, (_, i) => `tag ${i}`.padEnd(MAX_TAG_LENGTH, "x"));
    expect(tagProblem(most)).toBeNull();
    expect((await call("POST", "/manage/api/series", { title: `Tagged ${crypto.randomUUID()}`, tags: most }, { cookie })).status).toBe(200);

    const tooMany = [...most, "one more"];
    expect(tagProblem(tooMany)).not.toBeNull();
    expect((await call("POST", "/manage/api/series", { title: `Tagged ${crypto.randomUUID()}`, tags: tooMany }, { cookie })).status).toBe(422);
  });
});
