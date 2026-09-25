/**
 * The event parser, which now stands where the browser's own used to.
 *
 * Nothing controls how a chunk is cut: a frame can arrive whole, in halves, one character at a time, or four at
 * once. The parser is the only thing between that and the page, so every way a boundary can fall is worth a test —
 * this is the sort of code that works for months and then meets a slow network.
 */
import { describe, expect, test } from "bun:test";
import { openEventStream, SseParser } from "../src/sse";

/** Feeds a whole stream one character at a time, the worst cutting a parser can be given. */
function characterByCharacter(text: string): string[] {
  const parser = new SseParser();
  const events: string[] = [];
  for (const character of text) events.push(...parser.push(character));
  return events;
}

describe("reading frames out of a stream", () => {
  test("a whole frame arrives as one event", () => {
    expect(new SseParser().push('data: {"type":"log"}\n\n')).toEqual(['{"type":"log"}']);
  });

  test("two frames in one chunk come out in order", () => {
    expect(new SseParser().push("data: one\n\ndata: two\n\n")).toEqual(["one", "two"]);
  });

  test("a frame split across chunks is held until it is whole", () => {
    const parser = new SseParser();
    expect(parser.push("data: half")).toEqual([]);
    expect(parser.push(" a thing\n")).toEqual([]);
    expect(parser.push("\n")).toEqual(["half a thing"]);
  });

  test("the same stream, one character at a time, reads the same", () => {
    expect(characterByCharacter('data: {"a":1}\n\ndata: {"b":2}\n\n')).toEqual(['{"a":1}', '{"b":2}']);
  });

  test("keepalive comments are not events", () => {
    const parser = new SseParser();
    expect(parser.push(": keepalive\n\n")).toEqual([]);
    expect(parser.push("data: after the silence\n\n")).toEqual(["after the silence"]);
  });

  test("a comment sharing a chunk with an event doesn't swallow it", () => {
    expect(new SseParser().push(": keepalive\n\ndata: still here\n\n")).toEqual(["still here"]);
  });

  test("data over several lines is joined with newlines, as the specification says", () => {
    expect(new SseParser().push("data: first\ndata: second\n\n")).toEqual(["first\nsecond"]);
  });

  test("exactly one leading space is dropped, and no more", () => {
    expect(new SseParser().push("data:  two spaces\n\n")).toEqual([" two spaces"]);
    expect(new SseParser().push("data:none\n\n")).toEqual(["none"]);
  });

  test("an empty data line is an event, not nothing", () => {
    expect(new SseParser().push("data:\n\n")).toEqual([""]);
  });

  test("fields this client doesn't use are ignored rather than refused", () => {
    expect(new SseParser().push("event: page-updated\nid: 7\nretry: 1000\ndata: payload\n\n")).toEqual(["payload"]);
    // …and a frame carrying none of our fields produces nothing at all.
    expect(new SseParser().push("event: ping\nid: 8\n\n")).toEqual([]);
  });

  test("carriage returns are tolerated, however the line ends", () => {
    expect(new SseParser().push("data: windows\r\n\r\n")).toEqual(["windows"]);
    // Lone carriage returns, the old Mac ending. The last one is held while it could still be half of a CRLF, and
    // the frame comes out as soon as the next chunk settles the question.
    const parser = new SseParser();
    expect(parser.push("data: old mac\r\r")).toEqual([]);
    expect(parser.push("data: next\r\r")).toEqual(["old mac"]);
  });

  /**
   * A CRLF cut between its two characters. Turning that trailing CR into a line ending straight away would end the
   * data line *and* the frame one chunk early — and for an event whose data spans several lines, deliver the first
   * line on its own as a payload that JSON.parse then chokes on.
   */
  test("a CRLF split across chunks does not end the frame early", () => {
    const parser = new SseParser();
    expect(parser.push("data: payload\r")).toEqual([]);
    expect(parser.push("\n")).toEqual([]);
    expect(parser.push("\r\n")).toEqual(["payload"]);
  });

  test("…and a multi-line event cut the same way stays one event", () => {
    const parser = new SseParser();
    expect(parser.push("data: first\r")).toEqual([]);
    expect(parser.push("\ndata: second\r\n\r\n")).toEqual(["first\nsecond"]);
  });

  test("a chunk boundary between the two newlines does not lose the frame", () => {
    const parser = new SseParser();
    expect(parser.push("data: on the edge\n")).toEqual([]);
    expect(parser.push("\ndata: and the next\n\n")).toEqual(["on the edge", "and the next"]);
  });

  test("what has not been terminated is not reported", () => {
    const parser = new SseParser();
    expect(parser.push("data: still writing")).toEqual([]);
    // A stream that dies here must not hand over half an event; JSON.parse on it would throw in the caller.
    expect(parser.push("")).toEqual([]);
  });

  test("json with blank lines inside a string survives, because framing is by line", () => {
    const payload = JSON.stringify({ message: "line one\n\nline two" });
    expect(new SseParser().push(`data: ${payload}\n\n`)).toEqual([payload]);
  });
});

/** A Response whose body yields the given chunks, so the reader can be driven without a server. */
function streamOf(chunks: string[], init: ResponseInit = {}): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    init,
  );
}

/** Replaces fetch for one test and says what it was asked for. */
function withFetch(reply: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): {
  calls: { url: string; headers: Record<string, string>; redirect?: RequestRedirect }[];
  restore: () => void;
} {
  const calls: { url: string; headers: Record<string, string>; redirect?: RequestRedirect }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => { headers[key] = value; });
    calls.push({ url: String(input), headers, redirect: init?.redirect });
    return reply(input, init);
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

/** Waits for the stream's own reading to get where it is going. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10));

describe("opening a stream", () => {
  test("the key travels in a header, and never in the address", async () => {
    const fetcher = withFetch(async () => streamOf(["data: hello\n\n"]));
    try {
      const seen: string[] = [];
      openEventStream("https://reader.example/api/translate-page/7/live", "wo_secret", {
        onMessage: (data) => seen.push(data),
        onEnd: () => {},
      });
      await settle();

      expect(seen).toEqual(["hello"]);
      expect(fetcher.calls[0]!.headers["x-api-key"]).toBe("wo_secret");
      expect(fetcher.calls[0]!.url).not.toContain("wo_secret");
      expect(fetcher.calls[0]!.url).not.toContain("token");
    } finally {
      fetcher.restore();
    }
  });

  /**
   * The payloads here are Japanese more often than not, and a chunk boundary falls between bytes, not characters.
   * The decoder is told the stream continues so it holds a half-finished character back instead of turning it
   * into a replacement character that JSON.parse would then choke on.
   */
  test("a character split across two chunks arrives whole", async () => {
    const payload = JSON.stringify({ text: "鎧騎士の物語", stage: "ocr" });
    const bytes = new TextEncoder().encode(`data: ${payload}\n\n`);
    // Found rather than guessed: one byte past the start of the first multi-byte character, so the cut lands
    // inside it. (A hand-picked number landed in the ASCII before it, and the test proved nothing.)
    const firstWide = bytes.findIndex((byte) => byte >= 0x80);
    expect(firstWide).toBeGreaterThan(0);
    const cut = firstWide + 1;

    const fetcher = withFetch(async () => new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes.slice(0, cut));
          controller.enqueue(bytes.slice(cut));
          controller.close();
        },
      }),
    ));
    try {
      const seen: string[] = [];
      openEventStream("https://reader.example/events", "k", { onMessage: (d) => seen.push(d), onEnd: () => {} });
      await settle();

      expect(seen).toEqual([payload]);
      expect(seen[0]).not.toContain("\uFFFD");
      expect(JSON.parse(seen[0]!)).toEqual({ text: "鎧騎士の物語", stage: "ocr" });
    } finally {
      fetcher.restore();
    }
  });

  test("a refusal is reported with its status, not thrown into the page", async () => {
    const fetcher = withFetch(async () => new Response("no", { status: 401 }));
    try {
      const ends: string[] = [];
      openEventStream("https://reader.example/live", "wo_secret", { onMessage: () => {}, onEnd: (r) => ends.push(r) });
      await settle();
      expect(ends).toHaveLength(1);
      expect(ends[0]).toContain("401");
    } finally {
      fetcher.restore();
    }
  });

  test("the end of a stream is reported once, so a caller can decide to reopen", async () => {
    const fetcher = withFetch(async () => streamOf(["data: one\n\n", "data: two\n\n"]));
    try {
      const seen: string[] = [];
      const ends: string[] = [];
      openEventStream("https://reader.example/live", "k", { onMessage: (d) => seen.push(d), onEnd: (r) => ends.push(r) });
      await settle();
      expect(seen).toEqual(["one", "two"]);
      expect(ends).toHaveLength(1);
    } finally {
      fetcher.restore();
    }
  });

  test("closing says nothing further — the caller has moved on", async () => {
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const fetcher = withFetch(async () => new Response(
      new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(new TextEncoder().encode("data: first\n\n"));
          await held;
          controller.close();
        },
      }),
    ));
    try {
      const seen: string[] = [];
      const ends: string[] = [];
      const stream = openEventStream("https://reader.example/live", "k", {
        onMessage: (d) => seen.push(d),
        onEnd: (r) => ends.push(r),
      });
      await settle();
      expect(seen).toEqual(["first"]);

      stream.close();
      release?.();
      await settle();

      // Neither the end of the body nor the abort itself may be announced after close().
      expect(ends).toEqual([]);
    } finally {
      fetcher.restore();
    }
  });

  test("a network failure is reported in words, not as an unhandled rejection", async () => {
    const fetcher = withFetch(async () => { throw new TypeError("Failed to fetch"); });
    try {
      const ends: string[] = [];
      openEventStream("https://reader.example/live", "k", { onMessage: () => {}, onEnd: (r) => ends.push(r) });
      await settle();
      expect(ends).toEqual(["Failed to fetch"]);
    } finally {
      fetcher.restore();
    }
  });

  /**
   * The key goes in a header, and fetch keeps a custom header across a redirect — even a cross-origin one — so
   * following one would hand it to wherever the redirect pointed. Every other call the extension makes already
   * refuses redirects (api.ts); this one has to as well.
   */
  test("a redirect is refused rather than followed with the key attached", async () => {
    const fetcher = withFetch(async () => streamOf(["data: hello\n\n"]));
    try {
      openEventStream("https://reader.example/live", "wo_secret", { onMessage: () => {}, onEnd: () => {} });
      await settle();
      expect(fetcher.calls[0]!.redirect).toBe("error");
    } finally {
      fetcher.restore();
    }
  });

  test("and when the browser refuses one, the stream ends in words", async () => {
    // What fetch does with redirect: "error" — it rejects rather than returning a response.
    const fetcher = withFetch(async () => { throw new TypeError("Failed to fetch"); });
    try {
      const ends: string[] = [];
      openEventStream("https://reader.example/live", "wo_secret", { onMessage: () => {}, onEnd: (r) => ends.push(r) });
      await settle();
      expect(ends).toEqual(["Failed to fetch"]);
    } finally {
      fetcher.restore();
    }
  });

  test("without a key, no header is invented", async () => {
    const fetcher = withFetch(async () => streamOf([]));
    try {
      openEventStream("https://reader.example/live", "", { onMessage: () => {}, onEnd: () => {} });
      await settle();
      expect(fetcher.calls[0]!.headers["x-api-key"]).toBeUndefined();
    } finally {
      fetcher.restore();
    }
  });
});
