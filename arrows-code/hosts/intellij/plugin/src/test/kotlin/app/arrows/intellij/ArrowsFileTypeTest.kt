package app.arrows.intellij

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

class ArrowsFileTypeTest {
    @Test
    fun registersArrowsNameAndExtension() {
        assertEquals("Arrows", ArrowsFileType.name)
        assertEquals("arrows", ArrowsFileType.defaultExtension)
        assertFalse(ArrowsFileType.isBinary)
    }
}
