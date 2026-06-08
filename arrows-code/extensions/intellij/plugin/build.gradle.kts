plugins {
    kotlin("jvm")
    id("org.jetbrains.intellij.platform")
}

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    implementation(project(":core"))
    implementation("org.json:json:20240303")
    intellijPlatform {
        intellijIdeaCommunity("2024.3")
        testFramework(org.jetbrains.intellij.platform.gradle.TestFrameworkType.Platform)
    }
    testImplementation("junit:junit:4.13.2")
}

kotlin {
    jvmToolchain(21)
}

tasks.test { useJUnit() }

intellijPlatform {
    buildSearchableOptions = false // no custom settings UI to index
    pluginConfiguration {
        version = "0.1.0"
        ideaVersion {
            sinceBuild = "243"
            untilBuild = provider { null } // no upper bound: load on 251/261/… too
        }
    }
}

// Ship the curated embed the VS Code host packages (vscode/media/embed), not the raw Vite output
// (dist/apps/arrows-ts) — the latter carries dead font formats (eot/ttf/svg), an unused brand-icon
// set, and a cookie-consent stylesheet this offline plugin never uses. Drop the placeholder when present.
val embedBundle = rootProject.file("../vscode/media/embed")
val sharedMedia = rootProject.file("../vscode/media")     // reuse the VS Code host's icons
val examples = rootProject.file("../../fixtures/examples") // reuse the bundled examples
tasks.processResources {
    if (embedBundle.exists()) {
        exclude("embed/**")
        from(embedBundle) { into("embed") }
    }
    // Tool-window icon needs light + dark variants (currentColor renders black, invisible on the
    // dark stripe); IntelliJ auto-picks *_dark.svg under dark themes. Colors = the platform icon greys.
    from(sharedMedia) {
        include("sidebar-icon.svg"); into("icons"); rename { "arrows.svg" }
        filter { it.replace("stroke=\"currentColor\"", "stroke=\"#6C707E\"") }
    }
    from(sharedMedia) {
        include("sidebar-icon.svg"); into("icons"); rename { "arrows_dark.svg" }
        filter { it.replace("stroke=\"currentColor\"", "stroke=\"#CED0D6\"") }
    }
    // IntelliJ file-type icons are 16x16; the source SVG is 256px, so size this copy down (same artwork).
    from(sharedMedia) {
        include("file-icon.svg")
        into("icons")
        rename { "arrows-file.svg" }
        filter { line -> line.replace("width=\"256px\" height=\"256px\"", "width=\"16\" height=\"16\"") }
    }
    from(sharedMedia) { include("file-icon.svg"); into("META-INF"); rename { "pluginIcon.svg" } }
    from(examples) { include("*.arrows"); into("examples") }
    from(rootProject.file("../../libs/messages/src/lib")) { include("commands.json", "new-graph.json") }
}

// Guard against packaging a blank plugin: buildPlugin must ship the real canvas, not the placeholder.
val verifyEmbedBundle by tasks.registering {
    doLast {
        if (!embedBundle.exists()) {
            throw GradleException(
                "Embed bundle missing at $embedBundle. Build it first (cd ../vscode && npm run build); " +
                    "otherwise the packaged plugin ships a blank placeholder."
            )
        }
    }
}
tasks.named("buildPlugin") { dependsOn(verifyEmbedBundle) }
