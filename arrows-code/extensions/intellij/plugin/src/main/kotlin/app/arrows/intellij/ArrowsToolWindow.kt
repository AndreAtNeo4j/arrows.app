package app.arrows.intellij

import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import app.arrows.intellij.core.isGeneratedPath
import app.arrows.intellij.core.parseImportInput
import com.intellij.openapi.roots.ProjectFileIndex
import com.intellij.openapi.roots.ProjectRootManager
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.ui.SimpleToolWindowPanel
import com.intellij.openapi.vfs.VfsUtil
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.vfs.VirtualFileManager
import com.intellij.openapi.vfs.newvfs.BulkFileListener
import com.intellij.openapi.vfs.newvfs.events.VFileEvent
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.ColoredTreeCellRenderer
import com.intellij.ui.DoubleClickListener
import com.intellij.ui.SimpleTextAttributes
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.treeStructure.Tree
import javax.swing.Icon
import javax.swing.JTree
import javax.swing.tree.DefaultMutableTreeNode
import javax.swing.tree.DefaultTreeModel
import javax.swing.tree.TreeSelectionModel

private val EXAMPLE_NAMES = listOf(
    "citations", "iam-rbac", "lexical-graph", "microservices", "order-lifecycle", "social",
)

class ArrowsToolWindowFactory : ToolWindowFactory, DumbAware {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val panel = ArrowsToolWindowPanel(project)
        toolWindow.contentManager.addContent(
            com.intellij.ui.content.ContentFactory.getInstance().createContent(panel, "", false)
        )
        project.messageBus.connect(toolWindow.disposable).subscribe(
            VirtualFileManager.VFS_CHANGES,
            object : BulkFileListener {
                override fun after(events: List<VFileEvent>) {
                    if (events.any { it.path.endsWith(".arrows") }) panel.refresh()
                }
            },
        )
    }
}

private sealed interface Node {
    data class Section(val label: String, val icon: Icon) : Node
    data class Action(val label: String, val icon: Icon, val run: () -> Unit) : Node
    data class FileEntry(val file: VirtualFile) : Node
    data class Example(val name: String) : Node
    data class Empty(val label: String) : Node
}

private class ArrowsToolWindowPanel(private val project: Project) : SimpleToolWindowPanel(true, true) {
    private val root = DefaultMutableTreeNode()
    private val model = DefaultTreeModel(root)
    private val tree = Tree(model).apply {
        isRootVisible = false
        showsRootHandles = true
        selectionModel.selectionMode = TreeSelectionModel.SINGLE_TREE_SELECTION
        cellRenderer = ArrowsCellRenderer()
    }

    init {
        object : DoubleClickListener() {
            override fun onDoubleClick(event: java.awt.event.MouseEvent): Boolean = activateSelection()
        }.installOn(tree)

        val actions = DefaultActionGroup().apply {
            add(simpleAction("New Graph", AllIcons.General.Add) { newGraph() })
            add(simpleAction("Refresh", AllIcons.Actions.Refresh) { refresh() })
        }
        val bar = ActionManager.getInstance().createActionToolbar("ArrowsSidebar", actions, true)
        bar.targetComponent = tree
        toolbar = bar.component
        setContent(JBScrollPane(tree))
        refresh()
    }

    fun refresh() {
        root.removeAllChildren()
        root.add(section("Quick actions", AllIcons.Nodes.Folder, listOf(
            Node.Action("New graph", AllIcons.General.Add) { newGraph() },
            Node.Action("New from example…", AllIcons.Nodes.PpLib) { newFromExample() },
            Node.Action("Import shared graph…", AllIcons.Actions.Download) { importSharedGraph() },
        )))
        val files = workspaceArrowsFiles(project)
        root.add(section("In this workspace", AllIcons.Nodes.Folder,
            if (files.isEmpty()) listOf(Node.Empty("No .arrows files yet — try New graph"))
            else files.map { Node.FileEntry(it) }
        ))
        root.add(section("Examples", AllIcons.Nodes.PpLib, EXAMPLE_NAMES.map { Node.Example(it) }))
        model.reload()
        com.intellij.util.ui.tree.TreeUtil.expandAll(tree)
    }

    private fun section(label: String, icon: Icon, children: List<Node>): DefaultMutableTreeNode {
        val node = DefaultMutableTreeNode(Node.Section(label, icon))
        children.forEach { node.add(DefaultMutableTreeNode(it)) }
        return node
    }

    private fun activateSelection(): Boolean {
        val node = (tree.lastSelectedPathComponent as? DefaultMutableTreeNode)?.userObject ?: return false
        when (node) {
            is Node.Action -> node.run()
            is Node.FileEntry -> FileEditorManager.getInstance(project).openFile(node.file, true)
            is Node.Example -> useExampleAsTemplate(node.name)
            else -> return false
        }
        return true
    }

    private fun newGraph() {
        val dir = ProjectRootManager.getInstance(project).contentRoots.firstOrNull() ?: return
        val name = promptFileName("graph.arrows") ?: return
        writeAndOpen(dir, name, newGraphTemplate())
    }

    private fun newGraphTemplate(): String =
        javaClass.getResourceAsStream("/new-graph.json")?.bufferedReader()?.use { it.readText() }
            ?: """{"nodes":[],"relationships":[],"style":{}}"""

    private fun newFromExample() {
        val choice = Messages.showEditableChooseDialog(
            "Pick an example to copy into your workspace", "New From Example", null,
            EXAMPLE_NAMES.toTypedArray(), EXAMPLE_NAMES.first(), null
        ) ?: return
        useExampleAsTemplate(choice)
    }

    private fun importSharedGraph() {
        val input = Messages.showInputDialog(project, "Paste an arrows.app share URL or graph JSON", "Import Shared Graph", null)
            ?.takeIf { it.isNotBlank() } ?: return
        val graphJson = parseImportInput(input) ?: run {
            Messages.showErrorDialog(project, "Couldn't read an arrows graph from that input.", "Import Shared Graph")
            return
        }
        val dir = ProjectRootManager.getInstance(project).contentRoots.firstOrNull() ?: return
        val name = promptFileName("imported.arrows") ?: return
        writeAndOpen(dir, name, graphJson)
    }

    private fun useExampleAsTemplate(name: String) {
        if (name !in EXAMPLE_NAMES) return
        val content = javaClass.getResourceAsStream("/examples/$name.arrows")?.bufferedReader()?.use { it.readText() }
            ?: return
        val dir = ProjectRootManager.getInstance(project).contentRoots.firstOrNull() ?: return
        val target = promptFileName("$name.arrows") ?: return
        writeAndOpen(dir, target, content)
    }

    private fun promptFileName(default: String): String? {
        val name = Messages.showInputDialog(project, "File name", "Arrows", null, default, null)
            ?.takeIf { it.isNotBlank() } ?: return null
        return if (name.endsWith(".arrows")) name else "$name.arrows"
    }

    private fun writeAndOpen(dir: VirtualFile, fileName: String, content: String) {
        val existing = dir.findChild(fileName)
        if (existing != null && Messages.showOkCancelDialog(
                project, "$fileName already exists. Overwrite it?", "Arrows", "Overwrite", "Cancel", null,
            ) != Messages.OK
        ) return
        WriteCommandAction.runWriteCommandAction(project) {
            val file = existing ?: dir.createChildData(this, fileName)
            VfsUtil.saveText(file, content)
            FileEditorManager.getInstance(project).openFile(file, true)
        }
        refresh()
    }

    private fun simpleAction(text: String, icon: Icon, run: () -> Unit) =
        object : AnAction(text, text, icon), DumbAware {
            override fun actionPerformed(e: AnActionEvent) = run()
        }
}

private class ArrowsCellRenderer : ColoredTreeCellRenderer() {
    override fun customizeCellRenderer(
        tree: JTree, value: Any?, selected: Boolean, expanded: Boolean,
        leaf: Boolean, row: Int, hasFocus: Boolean,
    ) {
        when (val node = (value as? DefaultMutableTreeNode)?.userObject) {
            is Node.Section -> { icon = node.icon; append(node.label, SimpleTextAttributes.REGULAR_BOLD_ATTRIBUTES) }
            is Node.Action -> { icon = node.icon; append(node.label) }
            is Node.FileEntry -> { icon = ArrowsFileType.icon; append(node.file.name) }
            is Node.Example -> { icon = ArrowsFileType.icon; append(node.name); append("  bundled", SimpleTextAttributes.GRAYED_ATTRIBUTES) }
            is Node.Empty -> { icon = AllIcons.General.Information; append(node.label, SimpleTextAttributes.GRAYED_ATTRIBUTES) }
            else -> {}
        }
    }
}

internal fun workspaceArrowsFiles(project: Project): List<VirtualFile> {
    // isGeneratedPath on top of iterateContent drops build/output copies an unmarked project keeps.
    val result = mutableListOf<VirtualFile>()
    ProjectFileIndex.getInstance(project).iterateContent { vf ->
        if (!vf.isDirectory && vf.extension == "arrows" && !isGeneratedPath(vf.path)) {
            result.add(vf)
        }
        true
    }
    return result.sortedBy { it.path }
}
