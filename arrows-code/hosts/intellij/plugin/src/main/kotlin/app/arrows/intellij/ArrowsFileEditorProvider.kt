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

    // Canvas is the default view; the text editor stays available for "Show JSON".
    override fun getPolicy(): FileEditorPolicy = FileEditorPolicy.PLACE_BEFORE_DEFAULT_EDITOR
}
