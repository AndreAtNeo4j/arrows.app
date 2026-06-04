package app.arrows.intellij.core

import org.json.JSONObject
import java.net.URI
import java.net.URLEncoder
import java.util.Base64

val ALLOWED_EXTERNAL_HOSTS = setOf(
    "neo4j.com", "feedback.neo4j.com", "www.youtube.com", "youtube.com", "github.com",
)

fun isAllowedExternalUrl(url: String): Boolean {
    val uri = try { URI(url) } catch (_: Exception) { return false }
    return uri.scheme?.lowercase() == "https" && uri.userInfo == null && uri.host in ALLOWED_EXTERNAL_HOSTS
}

const val TUTORIAL_URL = "https://www.youtube.com/watch?v=ZHJ-BrKJ8A4"

fun arrowsAppImportUrl(graphJson: String): String {
    val b64 = Base64.getEncoder().encodeToString(graphJson.toByteArray())
    return "https://arrows.app/#/import/json=" + URLEncoder.encode(b64, "UTF-8")
}

// Browsers reject very long URLs; warn past this.
const val ARROWS_APP_URL_WARN_BYTES = 20_000

fun arrowsAppShare(graphJson: String): Pair<String, Boolean>? {
    val compact = runCatching { JSONObject(graphJson).toString() }.getOrNull() ?: return null
    return arrowsAppImportUrl(compact) to (compact.length > ARROWS_APP_URL_WARN_BYTES)
}

val GENERATED_DIRS = setOf(
    "node_modules", "build", "dist", "out", "target", ".gradle", ".idea", ".vscode-test", "coverage", "media",
)

fun isGeneratedPath(path: String): Boolean = path.split('/').any { it in GENERATED_DIRS }

val CYPHER_CLAUSES = listOf("CREATE", "MATCH", "MERGE")

// URI.path decodes once; a residual '%' means double-encoding (e.g. %252e%252e) - reject.
fun embedResourcePath(url: String): String? {
    val path = runCatching { URI(url).path }.getOrNull()?.trimStart('/')?.ifEmpty { "embed.html" } ?: return null
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
