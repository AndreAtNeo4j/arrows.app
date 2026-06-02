package app.arrows.intellij.protocol

import org.json.JSONObject
import java.net.URI
import java.net.URLEncoder
import java.util.Base64

// Pure host-action logic, unit-tested without the IDE; the editor/tool-window glue calls these.

// open-external: same allowlist as the VS Code host (commands/file.ts).
val ALLOWED_EXTERNAL_HOSTS = setOf(
    "neo4j.com", "feedback.neo4j.com", "www.youtube.com", "youtube.com", "github.com",
)

fun isAllowedExternalUrl(url: String): Boolean {
    val uri = try { URI(url) } catch (_: Exception) { return false }
    return uri.scheme?.lowercase() == "https" && uri.userInfo == null && uri.host in ALLOWED_EXTERNAL_HOSTS
}

// "Watch tutorial" target (mirrors VS Code's TUTORIAL_URL in commands/file.ts).
const val TUTORIAL_URL = "https://www.youtube.com/watch?v=ZHJ-BrKJ8A4"

/** open-in-arrows.app: base64 the graph JSON into an arrows.app import link. */
fun arrowsAppImportUrl(graphJson: String): String {
    val b64 = Base64.getEncoder().encodeToString(graphJson.toByteArray())
    return "https://arrows.app/#/import/json=" + URLEncoder.encode(b64, "UTF-8")
}

// Browsers reject very long URLs; warn past this (mirrors VS Code's ARROWS_APP_URL_WARN_BYTES).
const val ARROWS_APP_URL_WARN_BYTES = 20_000

// Compact the graph (drop indentation) for a shorter URL; null if it doesn't parse.
// Boolean = the graph is large enough that some browsers may reject the URL.
fun arrowsAppShare(graphJson: String): Pair<String, Boolean>? {
    val compact = runCatching { JSONObject(graphJson).toString() }.getOrNull() ?: return null
    return arrowsAppImportUrl(compact) to (compact.length > ARROWS_APP_URL_WARN_BYTES)
}

// Workspace scan: generated/output trees that hold copies of .arrows files.
val GENERATED_DIRS = setOf(
    "node_modules", "build", "dist", "out", "target", ".gradle", ".idea", ".vscode-test", "coverage", "media",
)

fun isGeneratedPath(path: String): Boolean = path.split('/').any { it in GENERATED_DIRS }

// Cypher export clause choices (mirrors the VS Code cypherClause.ts).
val CYPHER_CLAUSES = listOf("CREATE", "MATCH", "MERGE")

// Embed scheme handler: map a request URL to a classpath resource path (or null
// to 404) and its MIME type. The '..' guard blocks path traversal out of /embed.
fun embedResourcePath(url: String): String? {
    val path = runCatching { URI(url).path }.getOrNull()?.trimStart('/')?.ifEmpty { "embed.html" } ?: return null
    // URI.path is decoded once; a residual '%' means double-encoding (e.g. %252e%252e) - reject.
    if (".." in path || '%' in path) return null
    return "/embed/$path"
}

fun embedMimeType(path: String): String = when (path.substringAfterLast('.')) {
    "html" -> "text/html"
    "js" -> "text/javascript"
    "css" -> "text/css"
    "svg" -> "image/svg+xml"
    "png" -> "image/png"
    "ico" -> "image/x-icon"
    "woff2" -> "font/woff2"
    "woff" -> "font/woff"
    else -> "application/octet-stream"
}
