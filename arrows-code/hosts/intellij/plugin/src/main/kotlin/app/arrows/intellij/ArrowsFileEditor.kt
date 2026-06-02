package app.arrows.intellij

import app.arrows.intellij.protocol.CommandEntry
import app.arrows.intellij.protocol.GraphPayload
import app.arrows.intellij.protocol.HostActions
import app.arrows.intellij.protocol.RequestTracker
import app.arrows.intellij.protocol.dispatchInbound
import app.arrows.intellij.protocol.parseCommandMenu
import com.intellij.ide.BrowserUtil
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.diagnostic.thisLogger
import com.intellij.openapi.fileChooser.FileChooserFactory
import com.intellij.openapi.fileChooser.FileSaverDescriptor
import com.intellij.openapi.editor.Document
import com.intellij.openapi.editor.event.DocumentEvent
import com.intellij.openapi.editor.event.DocumentListener
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.FileEditorState
import com.intellij.openapi.fileEditor.OpenFileDescriptor
import com.intellij.openapi.ide.CopyPasteManager
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.UserDataHolderBase
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.ui.jcef.JBCefApp
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.ui.jcef.JBCefBrowserBase
import com.intellij.ui.jcef.JBCefJSQuery
import org.cef.CefApp
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.handler.CefLoadHandlerAdapter
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.awt.datatransfer.StringSelection
import java.beans.PropertyChangeListener
import java.net.URI
import java.net.URLEncoder
import java.util.Base64
import javax.swing.JComponent
import javax.swing.JLabel

// Same host allowlist as the VS Code host (commands/file.ts). Small + stable;
// if it grows, promote to a shared config like commands.json.
private val ALLOWED_EXTERNAL_HOSTS = setOf(
    "neo4j.com", "feedback.neo4j.com", "www.youtube.com", "youtube.com", "github.com",
)

/**
 * The arrows canvas in an editor tab. Loads the shared embed bundle in JCEF and
 * relays the same postMessage protocol the VS Code host uses, parsed by the
 * shared :protocol module. Feature logic lives in the bundle; this is transport.
 */
class ArrowsFileEditor(
    private val project: Project,
    private val file: VirtualFile,
) : UserDataHolderBase(), FileEditor, HostActions {

    private val document: Document? = FileDocumentManager.getInstance().getDocument(file)
    private val browser: JBCefBrowser? = if (JBCefApp.isSupported()) JBCefBrowser() else null
    private val jsQuery: JBCefJSQuery? = browser?.let { JBCefJSQuery.create(it as JBCefBrowserBase) }
    private val fallback = JLabel("JCEF is unavailable in this IDE runtime; cannot render the arrows canvas.")

    private val requests = RequestTracker()
    private val commandMenu: List<CommandEntry> = loadCommandMenu()

    @Volatile private var applyingHostEdit = false

    init {
        val b = browser
        val q = jsQuery
        if (b != null && q != null) {
            registerSchemeHandler()
            q.addHandler { raw -> dispatchInbound(raw, this); null }
            b.jbCefClient.addLoadHandler(object : CefLoadHandlerAdapter() {
                override fun onLoadEnd(browser: CefBrowser?, frame: CefFrame?, httpStatusCode: Int) {
                    injectBridge()
                    sendLoad()
                }
            }, b.cefBrowser)
            document?.addDocumentListener(object : DocumentListener {
                override fun documentChanged(event: DocumentEvent) {
                    if (!applyingHostEdit) sendLoad()
                }
            }, this)
            b.loadURL(EMBED_URL)
        }
    }

    private fun injectBridge() {
        val q = jsQuery ?: return
        // Forward window.postMessage to the JVM; host->embed messages we post back are inert to the inbound parser, so no loop.
        val js = """
            window.__arrowsToHost = function(payload) { ${q.inject("payload")} };
            window.addEventListener('message', function(e) {
                try { window.__arrowsToHost(JSON.stringify(e.data)); } catch (err) {}
            });
        """.trimIndent()
        browser?.cefBrowser?.executeJavaScript(js, EMBED_URL, 0)
    }

    private fun sendLoad() {
        // JCEF callbacks fire off the EDT; hop to it before reading the Document.
        ApplicationManager.getApplication().invokeLater {
            val doc = document ?: return@invokeLater
            val graph = currentGraph() ?: return@invokeLater
            val message = JSONObject()
                .put("type", "load")
                .put("graph", graph)
                .put("docVersion", doc.modificationStamp)
                .put("menu", menuPayload())
            browser?.cefBrowser?.executeJavaScript("window.postMessage($message, '*');", EMBED_URL, 0)
        }
    }

    private fun loadCommandMenu(): List<CommandEntry> {
        val json = javaClass.getResourceAsStream("/commands.json")
            ?.bufferedReader()?.use { it.readText() } ?: return emptyList()
        return parseCommandMenu(json)
    }

    private fun menuPayload(): JSONArray {
        val arr = JSONArray()
        commandMenu.forEach {
            arr.put(
                JSONObject()
                    .put("id", it.id)
                    .put("title", it.title)
                    .put("description", it.description)
                    .put("icon", it.icon)
            )
        }
        return arr
    }

    private fun requestFromEmbed(kind: String, payload: JSONObject?): java.util.concurrent.CompletableFuture<String> {
        val (id, future) = requests.create(kind)
        val msg = JSONObject().put("type", "request").put("kind", kind).put("requestId", id)
        if (payload != null) msg.put("payload", payload)
        browser?.cefBrowser?.executeJavaScript("window.postMessage($msg, '*');", EMBED_URL, 0)
        return future
    }

    // Run an embed request, hop back to the EDT, then apply the result or log the failure.
    private fun requestThen(kind: String, payload: JSONObject?, label: String, onResult: (String) -> Unit) {
        requestFromEmbed(kind, payload).whenComplete { result, err ->
            ApplicationManager.getApplication().invokeLater {
                if (err != null || result == null) thisLogger().warn("arrows $label failed: ${err?.message ?: "no result"}")
                else onResult(result)
            }
        }
    }

    private fun export(kind: String, payload: JSONObject?, ext: String, label: String) =
        requestThen(kind, payload, "$label export") { result ->
            val wrapper = FileChooserFactory.getInstance()
                .createSaveFileDialog(FileSaverDescriptor("Save $label", "", ext), project)
                .save(file.parent, "${file.nameWithoutExtension}.$ext") ?: return@requestThen
            wrapper.file.writeText(result)
        }

    private fun openInArrowsApp() {
        ApplicationManager.getApplication().invokeLater {
            val text = document?.text ?: return@invokeLater
            val b64 = Base64.getEncoder().encodeToString(text.toByteArray())
            BrowserUtil.browse("https://arrows.app/#/import/json=" + URLEncoder.encode(b64, "UTF-8"))
        }
    }

    override fun onReady() = sendLoad()

    override fun onGraphChanged(graph: GraphPayload, docVersion: Long?) {
        // Verbatim write preserves style and every top-level field.
        val nextText = JSONObject(graph.raw).toString(2)
        ApplicationManager.getApplication().invokeLater { writeGraphText(nextText) }
    }

    override fun onResponse(requestId: String, result: String?, error: String?) = requests.resolve(requestId, result, error)

    override fun onCommand(name: String) {
        when (name) {
            "arrows.openInArrowsApp" -> openInArrowsApp()
            "arrows.exportSvg" -> export("svg", null, "svg", "SVG")
            "arrows.exportGraphQL" -> export("graphql", null, "graphql", "GraphQL")
            "arrows.exportCypher" -> withCypherClause { export("cypher", JSONObject().put("keyword", it), "cypher", "Cypher") }
            "arrows.copyCypher" -> withCypherClause { copyCypher(it) }
            "arrows.openSource" -> showJson()
            "arrows.validate" -> runValidate()
            "arrows.format" -> runFormat()
            "arrows.renameLabel" -> runRename("label")
            "arrows.renameRelType" -> runRename("relType")
            else -> thisLogger().warn("arrows: unhandled embed command '$name'")
        }
    }

    // Same clause choice as the VS Code host (cypherClause.ts). Dialog must run on the EDT.
    private fun withCypherClause(then: (String) -> Unit) {
        ApplicationManager.getApplication().invokeLater {
            val clause = Messages.showEditableChooseDialog(
                "Cypher clause", "Cypher", null, arrayOf("CREATE", "MATCH", "MERGE"), "CREATE", null,
            ) ?: return@invokeLater
            then(clause)
        }
    }

    private fun copyCypher(clause: String) =
        requestThen("cypher", JSONObject().put("keyword", clause), "copy Cypher") {
            CopyPasteManager.getInstance().setContents(StringSelection(it))
        }

    private fun showJson() {
        ApplicationManager.getApplication().invokeLater {
            FileEditorManager.getInstance(project).openTextEditor(OpenFileDescriptor(project, file), true)
        }
    }

    // validate/format/rename run shared graph-logic inside the embed (over the
    // request channel), since the JVM can't run it directly. The host gathers
    // input natively, sends the graph, and applies the result.

    private fun currentGraph(): JSONObject? {
        val text = document?.text ?: return null
        return try { JSONObject(text) } catch (e: JSONException) { null }
    }

    private fun writeGraphText(text: String) {
        val doc = document ?: return
        if (project.isDisposed || doc.text == text) return
        applyingHostEdit = true
        try {
            WriteCommandAction.runWriteCommandAction(project) { doc.setText(text) }
        } finally {
            applyingHostEdit = false
        }
    }

    private fun notify(message: String) {
        NotificationGroupManager.getInstance().getNotificationGroup("Arrows")
            .createNotification(message, NotificationType.INFORMATION).notify(project)
    }

    private fun runValidate() = ApplicationManager.getApplication().invokeLater {
        val graph = currentGraph() ?: return@invokeLater
        requestThen("validate", JSONObject().put("graph", graph), "validate") { result ->
            val diags = JSONArray(result)
            notify(
                if (diags.length() == 0) "Arrows: no issues found."
                else "Arrows: ${diags.length()} issue(s): " +
                    (0 until diags.length()).joinToString("; ") { diags.getJSONObject(it).optString("message") }
            )
        }
    }

    private fun runFormat() = ApplicationManager.getApplication().invokeLater {
        // Layout ids mirror LAYOUTS in libs/graph-logic (the JVM host can't import the list).
        val algorithm = Messages.showEditableChooseDialog(
            "Layout", "Auto-arrange nodes", null,
            arrayOf("force", "hierarchical", "radial", "circular", "grid"), "force", null,
        ) ?: return@invokeLater
        val graph = currentGraph() ?: return@invokeLater
        requestThen("layout", JSONObject().put("graph", graph).put("algorithm", algorithm), "layout") { writeGraphText(it) }
    }

    private fun runRename(target: String) = ApplicationManager.getApplication().invokeLater {
        val graph = currentGraph() ?: return@invokeLater
        val names = collectNames(graph, target)
        if (names.isEmpty()) { notify("Arrows: no ${if (target == "label") "labels" else "relationship types"} to rename."); return@invokeLater }
        val from = Messages.showEditableChooseDialog("Rename which?", "Rename", null, names.toTypedArray(), names.first(), null) ?: return@invokeLater
        val to = Messages.showInputDialog(project, "New name for \"$from\"", "Rename", null, from, null)?.takeIf { it.isNotBlank() } ?: return@invokeLater
        val op = JSONObject().put("type", if (target == "label") "renameLabel" else "renameRelType")
        if (target == "label") op.put("oldLabel", from).put("newLabel", to) else op.put("oldType", from).put("newType", to)
        requestThen("rename", JSONObject().put("graph", graph).put("op", op), "rename") { writeGraphText(it) }
    }

    private fun collectNames(graph: JSONObject, target: String): List<String> {
        val out = sortedSetOf<String>()
        if (target == "label") {
            val nodes = graph.optJSONArray("nodes") ?: return emptyList()
            for (i in 0 until nodes.length()) {
                val labels = nodes.getJSONObject(i).optJSONArray("labels") ?: continue
                for (j in 0 until labels.length()) out.add(labels.getString(j))
            }
        } else {
            val rels = graph.optJSONArray("relationships") ?: return emptyList()
            for (i in 0 until rels.length()) rels.getJSONObject(i).optString("type").takeIf { it.isNotEmpty() }?.let(out::add)
        }
        return out.toList()
    }

    override fun onOpenExternal(url: String) {
        // Mirror the VS Code host allowlist: https only, no creds, known hosts.
        val uri = try { URI(url) } catch (_: Exception) { null }
        if (uri?.scheme == "https" && uri.userInfo == null && uri.host in ALLOWED_EXTERNAL_HOSTS) {
            BrowserUtil.browse(url)
        } else {
            thisLogger().warn("arrows: refusing to open external url: $url")
        }
    }
    override fun onEmbedError(message: String?, error: String?) =
        thisLogger().warn("arrows embed error: ${message.orEmpty()} ${error.orEmpty()}".trim())

    override fun getComponent(): JComponent = browser?.component ?: fallback
    override fun getPreferredFocusedComponent(): JComponent = component
    override fun getName(): String = "Arrows"
    override fun setState(state: FileEditorState) {}
    override fun isModified(): Boolean = false
    override fun isValid(): Boolean = true
    override fun addPropertyChangeListener(listener: PropertyChangeListener) {}
    override fun removePropertyChangeListener(listener: PropertyChangeListener) {}
    override fun getFile(): VirtualFile = file

    override fun dispose() {
        jsQuery?.let { Disposer.dispose(it) }
        browser?.let { Disposer.dispose(it) }
    }

    private companion object {
        @Volatile private var schemeRegistered = false

        fun registerSchemeHandler() {
            if (schemeRegistered) return
            synchronized(this) {
                if (schemeRegistered) return
                CefApp.getInstance().registerSchemeHandlerFactory("http", EMBED_HOST, EmbedSchemeHandlerFactory())
                schemeRegistered = true
            }
        }
    }
}
