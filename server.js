const http = require("node:http");
const { readFile } = require("node:fs/promises");
const path = require("node:path");

const root = __dirname;
const port = Number(process.env.PORT || 4173);
const ollamaHost = (process.env.OLLAMA_HOST || "http://127.0.0.1:11434").replace(/\/+$/, "");
const publicFiles = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
]);
const ollamaPaths = new Set(["/api/tags", "/api/chat"]);

function sendJson(response, status, value) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  if (requestUrl.pathname.startsWith("/api/ollama/")) {
    const ollamaPath = requestUrl.pathname.slice("/api/ollama".length);
    if (!ollamaPaths.has(ollamaPath) || !["GET", "POST"].includes(request.method)) {
      sendJson(response, 404, { error: "Unsupported Ollama endpoint." });
      return;
    }

    let targetUrl;
    try {
      targetUrl = new URL(`${ollamaPath}${requestUrl.search}`, `${ollamaHost}/`);
    } catch {
      sendJson(response, 500, { error: "OLLAMA_HOST must be a valid URL." });
      return;
    }

    const transport = targetUrl.protocol === "https:" ? require("node:https") : require("node:http");
    const upstream = transport.request(
      targetUrl,
      {
        method: request.method,
        headers: {
          "content-type": request.headers["content-type"] || "application/json",
          ...(request.headers["content-length"]
            ? { "content-length": request.headers["content-length"] }
            : {}),
        },
      },
      (upstreamResponse) => {
        response.writeHead(upstreamResponse.statusCode || 502, {
          "content-type": upstreamResponse.headers["content-type"] || "application/json",
          "cache-control": "no-store",
        });
        upstreamResponse.pipe(response);
      },
    );

    upstream.on("error", (error) => {
      if (!response.headersSent) {
        sendJson(response, 502, {
          error: `Could not reach Ollama at ${ollamaHost}: ${error.message}`,
        });
      } else {
        response.destroy(error);
      }
    });
    request.on("aborted", () => upstream.destroy());
    request.pipe(upstream);
    return;
  }

  const file = publicFiles.get(requestUrl.pathname);
  if (!file || request.method !== "GET") {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  try {
    const contents = await readFile(path.join(root, file[0]));
    response.writeHead(200, {
      "content-type": file[1],
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    response.end(contents);
  } catch (error) {
    sendJson(response, 500, { error: `Could not load ${file[0]}: ${error.message}` });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Ollama Readable UI is running at http://127.0.0.1:${port}`);
  console.log(`Using Ollama at ${ollamaHost}`);
});
