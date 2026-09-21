"use strict";

import {
  createServer,
  type IncomingMessage,
  type ServerResponse
} from "node:http";

type JsonObject = Record<string, any>;

type PinterestMedia = {
  type: "image" | "video";
  url: string;
  width?: number;
  height?: number;
};

type PinterestResult = {
  id: string;
  type: "image" | "video";
  title: string;
  description: string;
  author: string;
  username: string;
  pinUrl: string;
  media: string;
  thumbnail: string;
  width?: number;
  height?: number;
};

const PORT =
  Number(process.env.PORT) || 3000;

const PINTEREST =
  "https://www.pinterest.com";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/142.0.0.0 Safari/537.36";

const PINTEREST_HEADERS: Record<string, string> = {
  accept:
    "application/json, text/javascript, */*, q=0.01",

  "accept-language":
    "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",

  "user-agent":
    USER_AGENT,

  "x-requested-with":
    "XMLHttpRequest",

  "x-pinterest-appstate":
    "active",

  "x-pinterest-source-url":
    "/ideas/",

  "x-pinterest-pws-handler":
    "www/ideas.js"
};

function json(
  res: ServerResponse,
  status: number,
  data: unknown
): void {
  const body =
    JSON.stringify(
      data,
      null,
      2
    );

  res.writeHead(
    status,
    {
      "content-type":
        "application/json; charset=utf-8",

      "content-length":
        Buffer.byteLength(body),

      "access-control-allow-origin":
        "*",

      "access-control-allow-methods":
        "GET, OPTIONS",

      "cache-control":
        "no-store"
    }
  );

  res.end(body);
}

function errorMessage(
  error: unknown
): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

function text(
  value: unknown
): string {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function numberValue(
  value: unknown
): number | undefined {
  const parsed =
    Number(value);

  return Number.isFinite(parsed)
    ? parsed
    : undefined;
}

function isObject(
  value: unknown
): value is JsonObject {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isPinterestHost(
  hostname: string
): boolean {
  const host =
    hostname.toLowerCase();

  return (
    host === "pin.it" ||
    host.endsWith(".pin.it") ||
    host === "pinterest.com" ||
    host.endsWith(".pinterest.com") ||
    /^pinterest\.[a-z.]+$/i.test(host) ||
    /^[a-z-]+\.pinterest\.[a-z.]+$/i.test(host)
  );
}

function pinterestUrl(
  resource: string,
  data: JsonObject
): string {
  const url =
    new URL(
      `/resource/${resource}/get/`,
      PINTEREST
    );

  url.searchParams.set(
    "data",
    JSON.stringify(data)
  );

  return url.toString();
}

async function pinterestFetch(
  url: string,
  headers: Record<string, string> = {}
): Promise<JsonObject> {
  const response =
    await fetch(
      url,
      {
        method: "GET",

        headers: {
          ...PINTEREST_HEADERS,
          ...headers
        },

        redirect:
          "follow",

        signal:
          AbortSignal.timeout(
            15_000
          )
      }
    );

  if (!response.ok) {
    throw new Error(
      `Pinterest respondeu HTTP ${response.status}`
    );
  }

  const data =
    await response.json();

  if (!isObject(data)) {
    throw new Error(
      "Resposta inválida do Pinterest."
    );
  }

  return data;
}

function bestImage(
  images: unknown
): PinterestMedia | undefined {
  if (!isObject(images)) {
    return undefined;
  }

  let best:
    | PinterestMedia
    | undefined;

  let bestArea = 0;

  for (
    const value
    of Object.values(images)
  ) {
    if (!isObject(value)) {
      continue;
    }

    const url =
      text(value.url);

    if (!url) {
      continue;
    }

    const width =
      numberValue(
        value.width
      );

    const height =
      numberValue(
        value.height
      );

    const area =
      (width ?? 0) *
      (height ?? 0);

    if (
      !best ||
      area > bestArea
    ) {
      best = {
        type: "image",
        url,
        width,
        height
      };

      bestArea =
        area;
    }
  }

  return best;
}

function collectVideoMedia(
  value: unknown,
  output: PinterestMedia[],
  depth = 0
): void {
  if (
    depth > 12 ||
    value === null ||
    value === undefined
  ) {
    return;
  }

  if (
    Array.isArray(value)
  ) {
    for (
      const item
      of value
    ) {
      collectVideoMedia(
        item,
        output,
        depth + 1
      );
    }

    return;
  }

  if (!isObject(value)) {
    return;
  }

  if (
    isObject(
      value.video_list
    )
  ) {
    for (
      const video
      of Object.values(
        value.video_list
      )
    ) {
      if (!isObject(video)) {
        continue;
      }

      const url =
        text(video.url);

      if (!url) {
        continue;
      }

      output.push({
        type: "video",

        url,

        width:
          numberValue(
            video.width
          ),

        height:
          numberValue(
            video.height
          )
      });
    }
  }

  for (
    const child
    of Object.values(value)
  ) {
    collectVideoMedia(
      child,
      output,
      depth + 1
    );
  }
}

function bestVideo(
  pin: JsonObject
): PinterestMedia | undefined {
  const videos:
    PinterestMedia[] = [];

  collectVideoMedia(
    pin,
    videos
  );

  if (!videos.length) {
    return undefined;
  }

  const unique =
    [
      ...new Map(
        videos.map(
          item => [
            item.url,
            item
          ]
        )
      ).values()
    ];

  unique.sort(
    (a, b) => {
      const areaA =
        (a.width ?? 0) *
        (a.height ?? 0);

      const areaB =
        (b.width ?? 0) *
        (b.height ?? 0);

      return areaB - areaA;
    }
  );

  const mp4 =
    unique.find(
      item =>
        /\.mp4(?:\?|$)/i.test(
          item.url
        )
    );

  return (
    mp4 ??
    unique[0]
  );
}

function pinAuthor(
  pin: JsonObject
): {
  name: string;
  username: string;
} {
  const pinner =
    isObject(pin.pinner)
      ? pin.pinner
      : {};

  const attribution =
    isObject(
      pin.closeup_attribution
    )
      ? pin.closeup_attribution
      : {};

  return {
    name:
      text(
        pinner.full_name
      ) ||
      text(
        attribution.full_name
      ),

    username:
      text(
        pinner.username
      ) ||
      text(
        attribution.username
      )
  };
}

function normalizePin(
  pin: JsonObject
): PinterestResult | undefined {
  const id =
    text(pin.id);

  if (!id) {
    return undefined;
  }

  const video =
    bestVideo(pin);

  const image =
    bestImage(
      pin.images
    );

  const media =
    video ??
    image;

  if (!media?.url) {
    return undefined;
  }

  const thumbnail =
    image?.url ??
    media.url;

  const author =
    pinAuthor(pin);

  return {
    id,

    type:
      media.type,

    title:
      text(pin.title) ||
      text(pin.grid_title) ||
      text(pin.name) ||
      text(pin.auto_alt_text),

    description:
      text(
        pin.description
      ) ||
      text(
        pin.seo_description
      ) ||
      text(
        pin.rich_summary
          ?.display_description
      ),

    author:
      author.name,

    username:
      author.username,

    pinUrl:
      `${PINTEREST}/pin/${id}/`,

    media:
      media.url,

    thumbnail,

    width:
      media.width,

    height:
      media.height
  };
}

async function searchPinterest(
  query: string,
  limit: number
): Promise<PinterestResult[]> {
  const requestData = {
    options: {
      query,
      bookmarks: []
    },

    context: {}
  };

  const url =
    pinterestUrl(
      "BaseSearchResource",
      requestData
    );

  const response =
    await pinterestFetch(
      url
    );

  const resource =
    response.resource_response;

  const data =
    resource?.data;

  const results =
    Array.isArray(
      data?.results
    )
      ? data.results
      : [];

  const output:
    PinterestResult[] = [];

  for (
    const item
    of results
  ) {
    if (!isObject(item)) {
      continue;
    }

    if (
      item.type === "story"
    ) {
      continue;
    }

    const pin =
      normalizePin(item);

    if (!pin) {
      continue;
    }

    output.push(pin);

    if (
      output.length >= limit
    ) {
      break;
    }
  }

  return output;
}

async function resolvePinterestUrl(
  rawUrl: string
): Promise<string> {
  let url: URL;

  try {
    url =
      new URL(rawUrl);
  } catch {
    throw new Error(
      "URL inválida."
    );
  }

  if (
    !isPinterestHost(
      url.hostname
    )
  ) {
    throw new Error(
      "A URL não pertence ao Pinterest."
    );
  }

  if (
    url.hostname === "pin.it" ||
    url.hostname.endsWith(
      ".pin.it"
    )
  ) {
    const response =
      await fetch(
        url,
        {
          method: "GET",

          headers: {
            "user-agent":
              USER_AGENT,

            accept:
              "text/html,application/xhtml+xml"
          },

          redirect:
            "follow",

          signal:
            AbortSignal.timeout(
              15_000
            )
        }
      );

    if (!response.ok) {
      throw new Error(
        `Não foi possível resolver o link curto: HTTP ${response.status}`
      );
    }

    return response.url;
  }

  return url.toString();
}

function extractPinId(
  rawUrl: string
): string {
  const match =
    rawUrl.match(
      /\/pin\/(?:[^/?#]*--)?(\d+)(?:[/?#]|$)/i
    );

  if (!match?.[1]) {
    throw new Error(
      "Não consegui encontrar o ID do Pin nessa URL."
    );
  }

  return match[1];
}

async function getPinterestPin(
  rawUrl: string
): Promise<PinterestResult> {
  const resolvedUrl =
    await resolvePinterestUrl(
      rawUrl
    );

  const pinId =
    extractPinId(
      resolvedUrl
    );

  const requestData = {
    options: {
      field_set_key:
        "unauth_react_main_pin",

      id:
        pinId
    },

    context: {}
  };

  const url =
    pinterestUrl(
      "PinResource",
      requestData
    );

  const response =
    await pinterestFetch(
      url,
      {
        "x-pinterest-pws-handler":
          "www/[username].js",

        "x-pinterest-source-url":
          `/pin/${pinId}/`
      }
    );

  const pin =
    response
      .resource_response
      ?.data;

  if (!isObject(pin)) {
    throw new Error(
      "Pin não encontrado."
    );
  }

  const result =
    normalizePin(pin);

  if (!result) {
    throw new Error(
      "Não foi possível encontrar mídia nesse Pin."
    );
  }

  return result;
}

function parseLimit(
  value: string | null
): number {
  const number =
    Number.parseInt(
      value ?? "",
      10
    );

  if (
    !Number.isFinite(number)
  ) {
    return 10;
  }

  return Math.min(
    Math.max(
      number,
      1
    ),
    50
  );
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  if (
    req.method === "OPTIONS"
  ) {
    res.writeHead(
      204,
      {
        "access-control-allow-origin":
          "*",

        "access-control-allow-methods":
          "GET, OPTIONS",

        "access-control-allow-headers":
          "content-type"
      }
    );

    res.end();

    return;
  }

  if (
    req.method !== "GET"
  ) {
    json(
      res,
      405,
      {
        ok: false,
        error:
          "Método não permitido."
      }
    );

    return;
  }

  const url =
    new URL(
      req.url ?? "/",
      `http://${req.headers.host ?? "localhost"}`
    );

  if (
    url.pathname === "/" ||
    url.pathname === "/health"
  ) {
    json(
      res,
      200,
      {
        ok: true,
        service:
          "Lysielle Pinterest API",
        runtime:
          process.version
      }
    );

    return;
  }

  if (
    url.pathname ===
    "/pinterest/search"
  ) {
    const query =
      url.searchParams
        .get("q")
        ?.trim();

    if (!query) {
      json(
        res,
        400,
        {
          ok: false,
          error:
            "Use ?q=termo"
        }
      );

      return;
    }

    const limit =
      parseLimit(
        url.searchParams
          .get("limit")
      );

    try {
      const results =
        await searchPinterest(
          query,
          limit
        );

      json(
        res,
        200,
        {
          ok: true,
          query,
          count:
            results.length,
          results
        }
      );
    } catch (error) {
      console.error(
        "[Pinterest/Search]",
        error
      );

      json(
        res,
        502,
        {
          ok: false,
          error:
            errorMessage(
              error
            )
        }
      );
    }

    return;
  }

  if (
    url.pathname ===
    "/pinterest/pin"
  ) {
    const pinUrl =
      url.searchParams
        .get("url")
        ?.trim();

    if (!pinUrl) {
      json(
        res,
        400,
        {
          ok: false,
          error:
            "Use ?url=LINK_DO_PIN"
        }
      );

      return;
    }

    try {
      const result =
        await getPinterestPin(
          pinUrl
        );

      json(
        res,
        200,
        {
          ok: true,
          result
        }
      );
    } catch (error) {
      console.error(
        "[Pinterest/Pin]",
        error
      );

      json(
        res,
        502,
        {
          ok: false,
          error:
            errorMessage(
              error
            )
        }
      );
    }

    return;
  }

  json(
    res,
    404,
    {
      ok: false,
      error:
        "Endpoint não encontrado."
    }
  );
}

const server =
  createServer(
    (
      req,
      res
    ) => {
      handleRequest(
        req,
        res
      ).catch(
        error => {
          console.error(
            "[HTTP]",
            error
          );

          if (
            !res.headersSent
          ) {
            json(
              res,
              500,
              {
                ok: false,
                error:
                  "Erro interno."
              }
            );
          } else {
            res.end();
          }
        }
      );
    }
  );

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `💎 Lysielle Pinterest API online na porta ${PORT}`
    );
  }
);
