package app.arrows.intellij.protocol

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class CommandSurfaceTest {
    @Test
    fun listsTheSupportedCommands() {
        assertEquals(
            setOf("arrows.openInArrowsApp", "arrows.exportSvg", "arrows.exportCypher"),
            ARROWS_COMMANDS.map { it.id }.toSet()
        )
    }

    @Test
    fun everyEntryHasTitleAndIcon() {
        assertTrue(ARROWS_COMMANDS.all { it.title.isNotBlank() && it.icon.isNotBlank() })
    }
}
