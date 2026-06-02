package app.arrows.intellij.protocol

import kotlin.test.Test
import kotlin.test.assertEquals

class CommandSurfaceTest {
    private val sample = """
        [
          {"id":"a","title":"A","description":"da","icon":"ia","webview":true,"surface":{"sidebar":false,"embedMenu":true}},
          {"id":"b","title":"B","description":"db","icon":"ib","webview":false,"surface":{"sidebar":true,"embedMenu":false}},
          {"id":"c","title":"C","description":"dc","icon":"ic","webview":true,"surface":{"sidebar":false,"embedMenu":false}}
        ]
    """.trimIndent()

    @Test
    fun keepsOnlyWebviewEmbedMenuCommandsInOrder() {
        val menu = parseCommandMenu(sample)
        assertEquals(listOf("a"), menu.map { it.id })
        assertEquals(CommandEntry("a", "A", "da", "ia"), menu[0])
    }

    @Test
    fun emptyForMalformedJson() {
        assertEquals(emptyList(), parseCommandMenu("not json"))
    }
}
