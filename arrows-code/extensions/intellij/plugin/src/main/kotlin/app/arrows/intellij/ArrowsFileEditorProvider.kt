package app.arrows.intellij

import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorPolicy
import com.intellij.openapi.fileEditor.FileEditorProvider
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile

class ArrowsFileEditorProvider : FileEditorProvider, DumbAware {
    override fun accept(project: Project, file: VirtualFile): Boolean = file.extension == "arrows"

    override fun createEditor(project: Project, file: VirtualFile): FileEditor =
        ArrowsFileEditor(project, file)

    override fun getEditorTypeId(): String = "arrows.canvas"

    // Canvas only. A second (text) editor makes a 2-editor composite, which makes IntelliJ
    // remember "open as JSON" per file and trips a platform NPE on close (providerSelected !!).
    override fun getPolicy(): FileEditorPolicy = FileEditorPolicy.HIDE_DEFAULT_EDITOR
}
