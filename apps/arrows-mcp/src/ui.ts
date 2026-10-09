/**
 * MCP Apps (SEP-1865) inline view. Claude Desktop does not render `type: "image"` tool results
 * inline (anthropics/claude-ai-mcp#238), but it does render a `ui://` HTML resource, so the
 * diagram is painted into this sandboxed iframe instead.
 */
export const UI_RESOURCE_URI = 'ui://arrows/diagram.html';
export const UI_MIME_TYPE = 'text/html;profile=mcp-app';

/** Both spellings: the nested form is the spec, the flat one is the deprecated form hosts still read. */
export const UI_TOOL_META = {
  ui: { resourceUri: UI_RESOURCE_URI },
  'ui/resourceUri': UI_RESOURCE_URI,
};

/**
 * Self-contained HTML5 document - no bundler, no external URLs, so it satisfies the host's
 * default CSP (`img-src 'self' data:`, inline style/script allowed). It speaks raw JSON-RPC over
 * postMessage, so no client-side SDK is needed in the iframe.
 */
export const UI_VIEW_HTML = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><style>
  html,body{margin:0;padding:0;background:transparent}
  #root{padding:8px;font-family:var(--font-sans,sans-serif);color:var(--color-text-primary,#141413)}
  svg{display:block;max-width:100%;height:auto}
</style></head>
<body><div id="root">Rendering diagram…</div>
<script>
(function () {
  var root = document.getElementById("root");
  var id = 0, painted = false, toolArgs = null, toolName = null;

  function send(m) { parent.postMessage(m, "*"); }
  function notify(method, params) { send({ jsonrpc: "2.0", method: method, params: params || {} }); }

  function paint(svg) {
    if (!svg || painted) return;
    painted = true;
    root.innerHTML = svg;
    var r = root.getBoundingClientRect();
    // A zero height leaves the container collapsed even once it is visible.
    notify("ui/notifications/size-changed", { width: Math.ceil(r.width), height: Math.ceil(r.height) });
  }

  // Accept the svg from every shape a host might deliver it in.
  function svgFrom(res) {
    if (!res) return null;
    if (res.structuredContent && typeof res.structuredContent.svg === "string") return res.structuredContent.svg;
    var blocks = res.content || [];
    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      if (b && b.type === "text" && typeof b.text === "string") {
        try { var j = JSON.parse(b.text); if (j && typeof j.svg === "string") return j.svg; } catch (_) {}
        if (b.text.indexOf("<svg") !== -1) return b.text;
      }
      if (b && b.type === "resource" && b.resource && typeof b.resource.text === "string" &&
          b.resource.text.indexOf("<svg") !== -1) return b.resource.text;
    }
    return null;
  }

  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || d.jsonrpc !== "2.0") return;
    if (d.method === "ui/notifications/tool-input") {
      var p = d.params || {};
      toolArgs = p.arguments || null;
      toolName = p.toolName || p.name || (p.tool && p.tool.name) || null;
    }
    if (d.method === "ui/notifications/tool-result") paint(svgFrom(d.params));
  });

  function request(method, params) {
    var rid = ++id;
    send({ jsonrpc: "2.0", id: rid, method: method, params: params || {} });
    return new Promise(function (res, rej) {
      window.addEventListener("message", function h(e) {
        var d = e.data;
        if (d && d.jsonrpc === "2.0" && d.id === rid) {
          window.removeEventListener("message", h);
          d.error ? rej(new Error(JSON.stringify(d.error))) : res(d.result);
        }
      });
    });
  }

  var announced = false;
  function announce() { if (!announced) { announced = true; notify("ui/notifications/initialized", {}); } }

  request("ui/initialize", {
    protocolVersion: "2026-01-26",
    appInfo: { name: "Neo4j Arrows", version: "1.0.0" },
    appCapabilities: { availableDisplayModes: ["inline", "fullscreen"] }
  }).then(announce, announce);
  // The host holds the iframe hidden until initialized arrives, so send it even when the
  // ui/initialize response never comes (anthropics/claude-ai-mcp#165).
  setTimeout(announce, 1000);

  // Last resort: no tool-result ever arrived, so re-run the tool that opened this view and
  // read the svg out of the reply ourselves.
  setTimeout(function () {
    if (painted || !toolArgs) return;
    var name = toolName || (toolArgs.graph ? "arrows_render" : null);
    if (!name) return;
    request("tools/call", { name: name, arguments: toolArgs })
      .then(function (r) { paint(svgFrom(r)); }, function () {});
  }, 2500);
})();
</script></body></html>`;
