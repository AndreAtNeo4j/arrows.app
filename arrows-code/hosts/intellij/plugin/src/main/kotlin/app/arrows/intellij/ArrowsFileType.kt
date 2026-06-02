package app.arrows.intellij

import com.intellij.openapi.fileTypes.FileType
import com.intellij.openapi.vfs.VirtualFile
import javax.swing.Icon

object ArrowsFileType : FileType {
    override fun getName(): String = "Arrows"
    override fun getDescription(): String = "Arrows graph model"
    override fun getDefaultExtension(): String = "arrows"
    override fun getIcon(): Icon? = null
    override fun isBinary(): Boolean = false
    override fun isReadOnly(): Boolean = false
    override fun getCharset(file: VirtualFile, content: ByteArray): String = "UTF-8"
}
