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
    implementation(project(":protocol"))
    implementation("org.json:json:20240303")
    intellijPlatform {
        intellijIdeaCommunity("2024.3")
    }
}

kotlin {
    jvmToolchain(21)
}

intellijPlatform {
    buildSearchableOptions = false // no custom settings UI to index
    pluginConfiguration {
        version = "0.1.0"
        ideaVersion {
            sinceBuild = "243"
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
    from(sharedMedia) { include("sidebar-icon.svg"); into("icons"); rename { "arrows.svg" } }
    from(sharedMedia) { include("file-icon.svg"); into("META-INF"); rename { "pluginIcon.svg" } }
    from(examples) { include("*.arrows"); into("examples") }
    from(rootProject.file("../../libs/host-protocol/src/lib")) { include("commands.json") }
}

// Guard against packaging a blank plugin: buildPlugin must ship the real canvas,
// not the placeholder. (The placeholder bug was invisible because nothing checked.)
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
