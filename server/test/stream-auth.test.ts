/**
 * How the progress streams are authenticated, now that the extension reads them with `fetch`.
 *
 * They used to take a short-lived token in the query string, because `EventSource` cannot set headers — and a URL
 * is the one place a credential should never be, since it reaches proxy logs, browser history and referrers. The
 * extension now reads the streams with `fetch`, so the key travels in `X-Api-Key` like everything else and the
 * token path is gone. These tests pin both halves: the header works, and the query string is not a way in.
 */
import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { authGuard } from "@/plugins/auth/guard";
import { authPlugin } from "@/plugins/auth/index";
import { policyFor } from "@/plugins/auth/guard";
import { routeTranslatePage } from "@/plugins/route-translate-page";
import { PageStore } from "@/stores/page-store";
import { call, png, signedIn } from "./harness";

const app = new Elysia().use(authGuard).use(authPlugin).use(routeTranslatePage);

/** Opens a stream and gives back the response, having read nothing from it. */
async function open(path: string, headers: Record<string, string> = {}): Promise<Response> {
  return app.handle(new Request(`http://localhost${path}`, { headers }));
}

/** Reads the first chunk, then cancels — which is what stops the route's keepalive timer. */
async function firstChunk(response: Response): Promise<string> {
  const reader = response.body!.getReader();
  try {
    const { value } = await reader.read();
    return new TextDecoder().decode(value);
  } finally {
    await reader.cancel();
  }
}

async function contributorAndPage(): Promise<{ key: string; pageId: string }> {
  const contributor = await signedIn("contributor");
  const key = (await call("POST", "/auth/api/keys", { name: "extension" }, { cookie: contributor.cookie }))
    .body.key as string;

  const series = await call<{ series: { id: number } }>(
    "POST", "/manage/api/series", { title: `Streams ${crypto.randomUUID()}` }, { cookie: contributor.cookie },
  );
  const chapter = await call<{ unsorted: { id: number }[] }>(
    "POST", "/manage/api/chapters", { series_id: series.body.series.id, title: "Chapter 1" }, { cookie: contributor.cookie },
  );
  const form = new FormData();
  form.append("files", new File([await png()], "1.png", { type: "image/png" }));
  await call("POST", `/manage/api/chapters/${chapter.body.unsorted[0]!.id}/pages`, form, { cookie: contributor.cookie });

  const pages = await PageStore.listByChapter(chapter.body.unsorted[0]!.id);
  return { key, pageId: pages[0]!.id };
}

describe("the live stream", () => {
  test("opens for an API key sent as a header", async () => {
    const { key, pageId } = await contributorAndPage();
    const response = await open(`/api/translate-page/${pageId}/live`, { "x-api-key": key });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    // The route says hello with a comment, which is also what keeps proxies from buffering it.
    expect(await firstChunk(response)).toContain(":");
  });

  test("is refused without a credential", async () => {
    const { pageId } = await contributorAndPage();
    expect((await open(`/api/translate-page/${pageId}/live`)).status).toBe(401);
  });

  test("cannot be opened with a credential in the query string", async () => {
    const { key, pageId } = await contributorAndPage();

    // The old way in, gone: a token parameter authenticates nothing now…
    const withToken = await open(`/api/translate-page/${pageId}/live?stream_token=${key}`);
    expect(withToken.status).toBe(401);

    // …and neither does the real key put there, which is the mistake the token existed to avoid.
    const withKey = await open(`/api/translate-page/${pageId}/live?api_key=${key}&x-api-key=${key}`);
    expect(withKey.status).toBe(401);
  });
});

describe("the job progress stream", () => {
  /**
   * This one belongs to a job that lives in memory only while it runs, so a test cannot open a real one without
   * translating a page. What it can tell apart is *who was turned away by whom*: the guard answers 401 before the
   * route is reached, and the route answers 404 when it finds no such job. A 404 therefore means the credential
   * was accepted, which is the thing under test.
   */
  test("the header gets past the guard; the query string does not", async () => {
    const { key, pageId } = await contributorAndPage();

    const withHeader = await open(`/api/translate-page/${pageId}/events`, { "x-api-key": key });
    expect(withHeader.status).toBe(404);
    expect(await withHeader.json()).toEqual({ error: "job not found or expired" });

    const withQuery = await open(`/api/translate-page/${pageId}/events?stream_token=${key}`);
    expect(withQuery.status).toBe(401);

    const withNothing = await open(`/api/translate-page/${pageId}/events`);
    expect(withNothing.status).toBe(401);
  });
});

describe("the route that handed out stream tokens", () => {
  test("is gone, and unlisted routes fail closed", async () => {
    const contributor = await signedIn("contributor");
    const key = (await call("POST", "/auth/api/keys", { name: "old extension" }, { cookie: contributor.cookie }))
      .body.key as string;

    // Nothing lists it any more, and the policy table's default for an unlisted route is the strictest one.
    expect(policyFor("/api/stream-token")).toBe("admin");

    const refused = await call("POST", "/api/stream-token", {}, { key });
    expect(refused.status).not.toBe(200);
    expect(refused.body).not.toHaveProperty("token");
  });
});
