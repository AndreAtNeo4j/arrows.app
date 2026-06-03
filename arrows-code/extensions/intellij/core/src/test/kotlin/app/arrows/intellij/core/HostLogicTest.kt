package app.arrows.intellij.core

import java.util.Base64
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class HostLogicTest {
    @Test
    fun allowsKnownHttpsHosts() {
        assertTrue(isAllowedExternalUrl("https://neo4j.com/labs/arrows"))
        assertTrue(isAllowedExternalUrl("https://github.com/neo4j-labs/arrows.app"))
        assertTrue(isAllowedExternalUrl("https://www.youtube.com/watch?v=x"))
        assertTrue(isAllowedExternalUrl("HTTPS://neo4j.com"))   // scheme is case-insensitive
    }

    @Test
    fun tutorialUrlIsAllowed() {
        assertTrue(isAllowedExternalUrl(TUTORIAL_URL))
    }

    @Test
    fun rejectsNonHttpsUnknownHostCredsOrJunk() {
        assertFalse(isAllowedExternalUrl("http://neo4j.com"))            // not https
        assertFalse(isAllowedExternalUrl("https://evil.example.com"))    // unknown host
        assertFalse(isAllowedExternalUrl("https://user:pw@neo4j.com"))   // embedded creds
        assertFalse(isAllowedExternalUrl("javascript:alert(1)"))         // non-http scheme
        assertFalse(isAllowedExternalUrl("not a url"))                   // unparseable / no host
    }

    @Test
    fun buildsAndRoundTripsArrowsAppImportUrl() {
        val graph = """{"nodes":[],"relationships":[],"style":{}}"""
        val url = arrowsAppImportUrl(graph)
        assertTrue(url.startsWith("https://arrows.app/#/import/json="))
        val encoded = url.removePrefix("https://arrows.app/#/import/json=")
        val b64 = java.net.URLDecoder.decode(encoded, "UTF-8")
        assertEquals(graph, String(Base64.getDecoder().decode(b64)))
    }

    @Test
    fun arrowsAppShareCompactsParsesAndFlagsLargeGraphs() {
        assertNull(arrowsAppShare("not json"))                                  // unparseable -> null
        val small = arrowsAppShare("""{"nodes":[ ],"relationships":[ ]}""")!!
        assertTrue(small.first.startsWith("https://arrows.app/#/import/json="))
        assertFalse(small.second)                                               // small -> no warning
        val big = arrowsAppShare("""{"nodes":[],"x":"${"a".repeat(ARROWS_APP_URL_WARN_BYTES + 1)}"}""")!!
        assertTrue(big.second)                                                  // large -> warn
    }

    @Test
    fun skipsGeneratedOutputPaths() {
        assertTrue(isGeneratedPath("/proj/build/x.arrows"))
        assertTrue(isGeneratedPath("/proj/node_modules/p/y.arrows"))
        assertTrue(isGeneratedPath("/proj/arrows-code/extensions/vscode/media/examples/social.arrows"))
        assertTrue(isGeneratedPath("/proj/dist/apps/z.arrows"))
    }

    @Test
    fun keepsRealSourcePaths() {
        assertFalse(isGeneratedPath("/proj/graphs/a.arrows"))
        assertFalse(isGeneratedPath("/proj/arrows-code/fixtures/examples/social.arrows"))
    }

    @Test
    fun resolvesEmbedResourcePaths() {
        assertEquals("/embed/embed.html", embedResourcePath("http://arrows.local/"))
        assertEquals("/embed/embed.html", embedResourcePath("http://arrows.local/embed.html"))
        assertEquals("/embed/assets/embed-x.js", embedResourcePath("http://arrows.local/assets/embed-x.js"))
    }

    @Test
    fun rejectsTraversalAndUnparseableUrls() {
        assertNull(embedResourcePath("http://arrows.local/../META-INF/plugin.xml"))
        assertNull(embedResourcePath("http://arrows.local/%252e%252e/META-INF/plugin.xml")) // double-encoded
        assertNull(embedResourcePath("::::"))
    }

    @Test
    fun mapsCommonMimeTypes() {
        assertEquals("text/javascript", embedMimeType("assets/x.js"))
        assertEquals("image/svg+xml", embedMimeType("logo.svg"))
        assertEquals("font/woff2", embedMimeType("f.woff2"))
        assertEquals("application/octet-stream", embedMimeType("weird.xyz"))
    }
}
