package app.arrows.intellij

import com.intellij.openapi.fileEditor.FileEditorPolicy
import com.intellij.testFramework.fixtures.BasePlatformTestCase

// Host wiring only (provider, workspace scan). JCEF command bodies need a live browser, so they aren't covered here.
class ArrowsHostIntegrationTest : BasePlatformTestCase() {
    private val provider = ArrowsFileEditorProvider()

    fun testProviderAcceptsArrowsFilesOnly() {
        val arrows = myFixture.addFileToProject("graph.arrows", "{}").virtualFile
        val text = myFixture.addFileToProject("notes.txt", "x").virtualFile
        assertTrue(provider.accept(project, arrows))
        assertFalse(provider.accept(project, text))
    }

    // Pins the canvas-only policy: PLACE_BEFORE_DEFAULT_EDITOR built a 2-editor composite that
    // tripped a platform NPE on close (providerSelected!!) and drifted files to "open as JSON".
    fun testProviderHidesDefaultEditor() {
        assertEquals(FileEditorPolicy.HIDE_DEFAULT_EDITOR, provider.policy)
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
