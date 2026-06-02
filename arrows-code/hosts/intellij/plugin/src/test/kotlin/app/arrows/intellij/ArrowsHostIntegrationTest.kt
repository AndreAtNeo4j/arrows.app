package app.arrows.intellij

import com.intellij.openapi.fileEditor.FileEditorPolicy
import com.intellij.testFramework.fixtures.BasePlatformTestCase

/**
 * Headless-IDE integration smoke, the IntelliJ counterpart of the VS Code
 * commands-test.mjs: asserts the host wiring (editor provider, workspace scan)
 * against a real (in-process) project. JCEF command bodies need a live browser
 * and aren't exercised here, same as VS Code's webview-dependent checks.
 */
class ArrowsHostIntegrationTest : BasePlatformTestCase() {
    private val provider = ArrowsFileEditorProvider()

    fun testProviderAcceptsArrowsFilesOnly() {
        val arrows = myFixture.addFileToProject("graph.arrows", "{}").virtualFile
        val text = myFixture.addFileToProject("notes.txt", "x").virtualFile
        assertTrue(provider.accept(project, arrows))
        assertFalse(provider.accept(project, text))
    }

    fun testProviderPlacesCanvasBeforeTextEditor() {
        assertEquals(FileEditorPolicy.PLACE_BEFORE_DEFAULT_EDITOR, provider.policy)
        assertEquals("arrows.canvas", provider.editorTypeId)
    }

    fun testWorkspaceScanFindsSourceFilesAndSkipsGeneratedCopies() {
        myFixture.addFileToProject("graphs/social.arrows", "{}")
        myFixture.addFileToProject("build/copy.arrows", "{}")
        myFixture.addFileToProject("node_modules/dep/x.arrows", "{}")
        val names = workspaceArrowsFiles(project).map { it.name }
        assertTrue("source file listed", names.contains("social.arrows"))
        assertFalse("build copy skipped", names.contains("copy.arrows"))
        assertFalse("node_modules copy skipped", names.contains("x.arrows"))
    }
}
