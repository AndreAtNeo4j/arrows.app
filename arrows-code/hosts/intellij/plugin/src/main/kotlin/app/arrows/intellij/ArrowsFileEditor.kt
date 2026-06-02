package app.arrows.intellij

import app.arrows.intellij.protocol.CommandEntry
import app.arrows.intellij.protocol.GraphPayload
import app.arrows.intellij.protocol.HostActions
import app.arrows.intellij.protocol.RequestTracker
import app.arrows.intellij.protocol.CYPHER_CLAUSES
import app.arrows.intellij.protocol.arrowsAppImportUrl
import app.arrows.intellij.protocol.dispatchInbound
import app.arrows.intellij.protocol.isAllowedExternalUrl
import app.arrows.intellij.protocol.parseCommandMenu
import app.arrows.intellij.protocol.supportedEmbedMenu
import app.arrows.intellij.protocol.TUTORIAL_URL
import com.intellij.ide.BrowserUtil
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
import com.intellij.openapi.fileEditor.FileEditorState
import com.intellij.openapi.fileEditor.ex.FileEditorManagerEx
import com.intellij.openapi.fileEditor.impl.EditorWindow
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
import javax.swing.JComponent
import javax.swing.JLabel
import javax.swing.SwingConstants

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
    // Windowed (native, GPU-composited), not the platform-default OSR: OSR copies
    // every frame to a bitmap and paints it on the EDT, which makes canvas dragging
    // laggy on HiDPI.
    private val browser: JBCefBrowser? =
        if (JBCefApp.isSupported()) JBCefBrowser.createBuilder().setOffScreenRendering(false).build() else null
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
            val graph = try { JSONObject(doc.text) } catch (e: JSONException) { return@invokeLater }
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
        return supportedEmbedMenu(parseCommandMenu(json))
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

    private fun export(kind: String, payload: JSONObject?, ext: String, label: String) {
        requestFromEmbed(kind, payload).whenComplete { result, err ->
            ApplicationManager.getApplication().invokeLater {
                if (err != null || result == null) {
                    thisLogger().warn("arrows $label export failed: ${err?.message ?: "no result"}")
                    return@invokeLater
                }
                val descriptor = FileSaverDescriptor("Save $label", "", ext)
                val wrapper = FileChooserFactory.getInstance()
                    .createSaveFileDialog(descriptor, project)
                    .save(file.parent, "${file.nameWithoutExtension}.$ext") ?: return@invokeLater
                wrapper.file.writeText(result)
            }
        }
    }

    private fun openInArrowsApp() {
        ApplicationManager.getApplication().invokeLater {
            val text = document?.text ?: return@invokeLater
            BrowserUtil.browse(arrowsAppImportUrl(text))
        }
    }

    override fun onReady() = sendLoad()

    override fun onGraphChanged(graph: GraphPayload, docVersion: Long?) {
        val doc = document ?: return
        // Write the graph back verbatim - preserves style and every top-level
        // field. (Canonical key ordering would need the bundle to emit it.)
        val nextText = JSONObject(graph.raw).toString(2)
        ApplicationManager.getApplication().invokeLater {
            if (project.isDisposed || doc.text == nextText) return@invokeLater
            applyingHostEdit = true
            try {
                WriteCommandAction.runWriteCommandAction(project) { doc.setText(nextText) }
            } finally {
                applyingHostEdit = false
            }
        }
    }

    override fun onResponse(requestId: String, result: String?, error: String?) = requests.resolve(requestId, result, error)

    override fun onCommand(name: String) {
        when (name) {
            "arrows.openInArrowsApp" -> openInArrowsApp()
            "arrows.openTutorial" -> onOpenExternal(TUTORIAL_URL)
            "arrows.exportSvg" -> export("svg", null, "svg", "SVG")
            "arrows.exportGraphQL" -> export("graphql", null, "graphql", "GraphQL")
            "arrows.exportCypher" -> withCypherClause { export("cypher", JSONObject().put("keyword", it), "cypher", "Cypher") }
            "arrows.copyCypher" -> withCypherClause { copyCypher(it) }
            "arrows.openSource" -> showJson()
            else -> thisLogger().warn("arrows: unhandled embed command '$name'")
        }
    }

    // Same clause choice as the VS Code host (cypherClause.ts). Dialog must run on the EDT.
    private fun withCypherClause(then: (String) -> Unit) {
        ApplicationManager.getApplication().invokeLater {
            val clause = Messages.showEditableChooseDialog(
                "Cypher clause", "Cypher", null,
                CYPHER_CLAUSES.toTypedArray(), CYPHER_CLAUSES.first(), null,
            ) ?: return@invokeLater
            then(clause)
        }
    }

    private fun copyCypher(clause: String) {
        requestFromEmbed("cypher", JSONObject().put("keyword", clause)).whenComplete { result, err ->
            ApplicationManager.getApplication().invokeLater {
                if (err != null || result == null) thisLogger().warn("arrows copy Cypher failed: ${err?.message ?: "no result"}")
                else CopyPasteManager.getInstance().setContents(StringSelection(result))
            }
        }
    }

    private fun showJson() {
        ApplicationManager.getApplication().invokeLater {
            if (project.isDisposed) return@invokeLater
            val source = FileEditorManagerEx.getInstanceEx(project).currentWindow ?: return@invokeLater
            // Canvas stays in this pane; open JSON in the split beside it. The split's editors
            // load async, so flip it to the text view once its composite is populated.
            val split = source.split(SwingConstants.VERTICAL, true, file, false) ?: return@invokeLater
            selectJsonWhenLoaded(split, attempts = 40)
        }
    }

    private fun selectJsonWhenLoaded(window: EditorWindow, attempts: Int) {
        if (project.isDisposed) return
        val composite = window.getComposite(file)
        val textProvider = composite?.allProviders?.firstOrNull { it !is ArrowsFileEditorProvider }
        when {
            textProvider != null -> composite.setSelectedEditor(textProvider.editorTypeId)
            attempts > 0 -> ApplicationManager.getApplication().invokeLater { selectJsonWhenLoaded(window, attempts - 1) }
            else -> thisLogger().warn("arrows showJson: text editor never loaded (providers=${composite?.allProviders?.map { it.editorTypeId }})")
        }
    }

    override fun onOpenExternal(url: String) {
        if (isAllowedExternalUrl(url)) BrowserUtil.browse(url)
        else thisLogger().warn("arrows: refusing to open external url: $url")
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
