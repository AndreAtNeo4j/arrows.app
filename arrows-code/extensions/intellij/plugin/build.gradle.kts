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

// Ship the shared embed bundle if it has been built (dist/apps/arrows-ts, the
// same artifact the VS Code host bundles). Drop the placeholder when present.
val embedBundle = rootProject.file("../../../dist/apps/arrows-ts")
val sharedMedia = rootProject.file("../vscode/media")     // reuse the VS Code host's icons
val examples = rootProject.file("../../fixtures/examples") // reuse the bundled examples
tasks.processResources {
    if (embedBundle.exists()) {
        exclude("embed/**")
        from(embedBundle) { into("embed") }
    }
    // Tool-window stripe icon: 16px, inset ~10% and ~1px stroke so it sits like the platform's
    // line icons instead of filling the slot edge-to-edge (same artwork as the VS Code activity bar).
    from(sharedMedia) {
        include("sidebar-icon.svg")
        into("icons")
        rename { "arrows.svg" }
        filter { line ->
            line.replace("width=\"24\" height=\"24\" viewBox=\"0 0 256 256\"", "width=\"16\" height=\"16\" viewBox=\"-32 -32 320 320\"")
                .replace("stroke-width=\"14\"", "stroke-width=\"20\"")
        }
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
